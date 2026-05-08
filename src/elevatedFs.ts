import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * 提权文件操作工具
 *
 * 当 Windsurf 安装在受 Windows UAC 保护的目录（如 Program Files）时，
 * 普通 fs 操作会抛 EPERM。本模块提供 fallback：
 *   1. 先尝试普通写入
 *   2. 若 EPERM 且平台为 Windows，写入临时文件后通过提权 PowerShell 拷贝到目标
 *
 * 批量模式（推荐）：
 *   beginElevatedBatch() → 多次 writeFileWithElevation/copyFileWithElevation → flushElevatedBatch()
 *   所有操作排队，flush 时先尝试普通写入，若遇 EPERM 则合并为单个提权脚本，仅弹一次 UAC。
 *
 * 单次模式（兼容）：
 *   不在 batch 中的调用仍独立执行，EPERM 时单独提权。
 */

// ────── 内部状态 ──────

interface PendingWrite { type: 'write'; dest: string; content: string; encoding: BufferEncoding }
interface PendingCopy  { type: 'copy';  src: string;  dest: string }
type PendingOp = PendingWrite | PendingCopy;

let _batch: PendingOp[] | null = null;

// ────── 自定义错误 ──────

export class ElevationError extends Error {
  /** true = 用户主动拒绝 UAC；false = 其他提权失败 */
  readonly userDenied: boolean;
  constructor(message: string, userDenied: boolean) {
    super(message);
    this.name = 'ElevationError';
    this.userDenied = userDenied;
  }
}

// ────── 工具函数 ──────

function isEPERM(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPERM';
}

function esc(s: string): string { return s.replace(/'/g, "''"); }

/**
 * 检测目标目录是否需要提权写入（结果缓存于进程生命周期）
 */
const _elevationCache = new Map<string, boolean>();
function needsElevation(targetPath: string): boolean {
  const dir = path.dirname(targetPath);
  if (_elevationCache.has(dir)) return _elevationCache.get(dir)!;
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    _elevationCache.set(dir, false);
    return false;
  } catch {
    _elevationCache.set(dir, true);
    return true;
  }
}

/** 判断 execSync 错误是否为 UAC 拒绝 */
function isUacDenied(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return msg.includes('canceled') || msg.includes('cancelled')
    || msg.includes('denied') || msg.includes('1223');
}

/**
 * 执行提权 PowerShell 脚本（Windows 专用）
 * 将脚本内容写入临时 .ps1 文件，通过 Start-Process -Verb RunAs 触发 UAC。
 * 脚本末尾写入哨兵文件，执行后校验以检测静默失败。
 */
function runElevatedScript(scriptContent: string): void {
  const ts = Date.now();
  const scriptPath = path.join(os.tmpdir(), `wp-elevate-${ts}.ps1`);
  const sentinelPath = path.join(os.tmpdir(), `wp-sentinel-${ts}`);

  // 哨兵：脚本成功执行完毕后写入标记文件
  const fullScript = scriptContent + `\n'ok' | Out-File -LiteralPath '${esc(sentinelPath)}' -Encoding utf8`;
  fs.writeFileSync(scriptPath, fullScript, 'utf8');

  try {
    const escaped = scriptPath.replace(/'/g, "''");
    execSync(
      `powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escaped}')"`,
      { windowsHide: true, timeout: 120_000 }
    );

    // 校验哨兵文件
    if (!fs.existsSync(sentinelPath)) {
      throw new ElevationError(
        'Windsurf 安装目录写入失败：提权脚本未正常完成，请尝试以管理员身份运行 Windsurf。',
        false
      );
    }
  } catch (err) {
    if (err instanceof ElevationError) throw err;
    if (isUacDenied(err)) {
      throw new ElevationError(
        'Windsurf 安装在受保护目录（如 Program Files），需要管理员权限。请在弹出的权限对话框中点击「是」，或以管理员身份运行 Windsurf。',
        true
      );
    }
    throw new ElevationError(
      `提权执行失败: ${err instanceof Error ? err.message : String(err)}`,
      false
    );
  } finally {
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    try { fs.unlinkSync(sentinelPath); } catch { /* ignore */ }
  }
}

// ────── 批量执行引擎 ──────

/**
 * 执行一组操作：先尝试普通 fs，遇 EPERM 时全部走提权（单次 UAC）
 */
function executeOps(ops: PendingOp[]): void {
  if (ops.length === 0) return;

  // 快速判断：目标目录是否可写
  const elevated = process.platform === 'win32' && ops.some(op => needsElevation(op.dest));

  if (!elevated) {
    // 普通模式：逐个执行
    for (const op of ops) {
      if (op.type === 'write') {
        fs.writeFileSync(op.dest, op.content, op.encoding);
      } else {
        fs.copyFileSync(op.src, op.dest);
      }
    }
    return;
  }

  // 提权模式：写临时文件 + 构建单个 PS1 脚本
  const tmpFiles: string[] = [];
  const lines: string[] = [];

  for (const op of ops) {
    if (op.type === 'write') {
      const tmp = path.join(os.tmpdir(), `wp-${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(op.dest)}`);
      fs.writeFileSync(tmp, op.content, op.encoding);
      tmpFiles.push(tmp);
      lines.push(`Copy-Item -LiteralPath '${esc(tmp)}' -Destination '${esc(op.dest)}' -Force`);
    } else {
      lines.push(`Copy-Item -LiteralPath '${esc(op.src)}' -Destination '${esc(op.dest)}' -Force`);
    }
  }

  try {
    runElevatedScript(lines.join('\n'));
  } finally {
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}

// ────── 公开 API: 批量模式 ──────

/**
 * 开始收集文件操作（调用后 writeFileWithElevation/copyFileWithElevation 只入队不执行）
 */
export function beginElevatedBatch(): void {
  _batch = [];
}

/**
 * 执行所有已收集的操作（需要提权时仅弹一次 UAC）
 * 如果队列为空则无操作
 */
export function flushElevatedBatch(): void {
  if (!_batch || _batch.length === 0) {
    _batch = null;
    return;
  }
  const ops = _batch;
  _batch = null;
  executeOps(ops);
}

/**
 * 取消批量模式，丢弃所有已收集的操作
 */
export function cancelElevatedBatch(): void {
  _batch = null;
}

// ────── 公开 API: 单次操作（批量模式下自动入队） ──────

/**
 * 写入文件，EPERM 时自动提权（Windows UAC）
 * 批量模式下仅入队，flush 时统一执行
 */
export function writeFileWithElevation(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): void {
  if (_batch !== null) {
    _batch.push({ type: 'write', dest: filePath, content, encoding });
    return;
  }
  executeOps([{ type: 'write', dest: filePath, content, encoding }]);
}

/**
 * 复制文件，EPERM 时自动提权（Windows UAC）
 * 批量模式下仅入队，flush 时统一执行
 */
export function copyFileWithElevation(src: string, dest: string): void {
  if (_batch !== null) {
    _batch.push({ type: 'copy', src, dest });
    return;
  }
  executeOps([{ type: 'copy', src, dest }]);
}
