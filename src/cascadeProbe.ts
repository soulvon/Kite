/**
 * Cascade Canary Probe — 通过本地 LS 的 Cascade 协议发送一条 "hi" 消息，
 * 检测账号是否被 "overall message rate limit" 限速。
 *
 * 协议：gRPC+JSON (Content-Type: application/grpc+json)
 * 流程：StartCascade → SendUserCascadeMessage → 轮询 GetCascadeTrajectorySteps
 */
import * as http from 'http';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { execSync, spawn, ChildProcess } from 'child_process';
import { getIdeVersion, getExtensionsDirBase } from './ideDetector';

// ── LS 发现缓存 ──
export interface LsInfo {
  port: number;
  csrf: string;
  ideVersion: string;
  ts: number;
  isolated?: boolean;
  root?: string;
  proc?: ChildProcess;
}

let _lsCache: LsInfo | null = null;
const LS_CACHE_TTL_MS = 60_000; // 60s 缓存
let _isolatedLs: LsInfo | null = null;

// ── LS 池（并行测活用） ──
const _lsPool: LsInfo[] = [];
const _lsPoolBusy = new Set<LsInfo>();
const _lsProbeCount = new Map<LsInfo, number>();
const MAX_PROBES_PER_LS = 20; // 每个 LS 最多做 20 次 probe 后回收
let _lsPoolTargetSize = 3; // 池目标大小（满载回收后自动补充到此数量）
let _recyclePromise: Promise<void> | null = null; // 回收锁，防止多 worker 并发重复 spawn

// ── 全局 probe 频率限制（滑动窗口，防止 IP 级限速） ──
const PROBE_RATE_WINDOW_MS = 60_000; // 1 分钟窗口
const PROBE_RATE_MAX = 120; // 每分钟最多 120 次（基本不限，快速冲完避免 IP 限速传播延迟）
const _probeTimestamps: number[] = [];
let _probeWaiters: Array<() => void> = [];

async function waitForProbeSlot(): Promise<void> {
  const now = Date.now();
  // 清除过期时间戳
  while (_probeTimestamps.length > 0 && _probeTimestamps[0]! <= now - PROBE_RATE_WINDOW_MS) {
    _probeTimestamps.shift();
  }
  if (_probeTimestamps.length < PROBE_RATE_MAX) {
    _probeTimestamps.push(now);
    return;
  }
  // 等待最早的 slot 过期
  const waitMs = _probeTimestamps[0]! + PROBE_RATE_WINDOW_MS - now + 100;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      const idx = _probeWaiters.indexOf(resolve);
      if (idx >= 0) _probeWaiters.splice(idx, 1);
      resolve();
    }, waitMs);
    _probeWaiters.push(() => { clearTimeout(timer); resolve(); });
  });
  // 重入检查
  return waitForProbeSlot();
}

/** TCP 快速探活：检测端口是否还在监听 */
function checkPortAlive(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise(resolve => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(false); });
  });
}

export const LS_SERVICE = '/exa.language_server_pb.LanguageServerService';

// ── gRPC+JSON 帧编解码 ──
function grpcFrame(obj: any): Buffer {
  const p = Buffer.from(JSON.stringify(obj));
  const h = Buffer.alloc(5);
  h.writeUInt32BE(p.length, 1); // flags=0, length=BE32
  return Buffer.concat([h, p]);
}

function parseGrpcFrames(buf: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  let off = 0;
  while (off + 5 <= buf.length) {
    const len = buf.readUInt32BE(off + 1);
    if (off + 5 + len > buf.length) break;
    frames.push(buf.subarray(off + 5, off + 5 + len));
    off += 5 + len;
  }
  return frames;
}

// ── gRPC+JSON unary call ──
export function grpcPost(port: number, csrf: string, path: string, body: any, timeoutMs = 15000): Promise<{
  grpcStatus: string;
  grpcMsg: string;
  json: any;
}> {
  const frame = grpcFrame(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc+json',
        'x-codeium-csrf-token': csrf,
        'te': 'trailers',
        'Content-Length': frame.length,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const trailers = (res as any).trailers || {};
        const grpcStatus = trailers['grpc-status'] ?? (res.headers as any)['grpc-status'] ?? '';
        const grpcMsg = trailers['grpc-message'] ?? (res.headers as any)['grpc-message'] ?? '';
        let json: any = null;
        try {
          const frames = parseGrpcFrames(raw);
          if (frames.length) { json = JSON.parse(frames[0].toString()); }
        } catch { /* ignore */ }
        resolve({ grpcStatus: String(grpcStatus), grpcMsg: String(grpcMsg), json });
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('cascade probe timeout')); }, timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(frame);
    req.end();
  });
}

// ── LS 发现 (PID → port + CSRF + ideVersion) ──

/**
 * 在 Windows 上通过 P/Invoke 读取 LS 进程的 WINDSURF_CSRF_TOKEN 环境变量，
 * 同时提取 --extension_server_port 和 --windsurf_version 命令行参数。
 *
 * 返回所有活跃 LS 实例的信息。
 */
/** 扩展根目录（运行时由 activate 设置） */
let _extensionPath = '';

export function setExtensionPath(p: string): void {
  _extensionPath = p;
}

export function discoverLsInstances(): LsInfo[] {
  try {
    if (process.platform === 'win32') {
      return discoverLsWindows();
    } else {
      return discoverLsUnix();
    }
  } catch (e) {
    console.warn('[cascadeProbe] discoverLsInstances failed:', e);
    return [];
  }
}

function discoverLsWindows(): LsInfo[] {
  const ps1 = _extensionPath
    ? path.join(_extensionPath, 'resources', 'get_ls_info.ps1')
    : path.join(__dirname, '..', 'resources', 'get_ls_info.ps1');
  const output = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, {
    timeout: 15000, encoding: 'utf8', windowsHide: true,
  }).trim();
  if (!output) return [];
  const results: LsInfo[] = [];
  for (const line of output.split('\n')) {
    const parts = line.trim().split('|');
    if (parts.length >= 3 && parts[1]) {
      results.push({ port: parseInt(parts[0], 10), csrf: parts[1], ideVersion: parts[2], ts: Date.now() });
    }
  }
  return results;
}

function discoverLsUnix(): LsInfo[] {
  // 查找 language_server 进程
  // macOS 二进制名：新版 language_server_macos_*，旧版 language_server_darwin_*
  const lsGrep = process.platform === 'darwin' ? 'language_server_' : 'language_server_linux';
  const psOut = execSync(`ps -eo pid,args 2>/dev/null | grep '${lsGrep}' | grep -v grep`, {
    timeout: 5000, encoding: 'utf8',
  }).trim();
  if (!psOut) return [];

  const results: LsInfo[] = [];
  for (const line of psOut.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+/);
    if (!m) continue;
    const pid = m[1];
    const cmdLine = line.trim().substring(m[0].length);

    // 提取 CSRF token
    let csrf = '';
    try {
      if (process.platform === 'darwin') {
        const env = execSync(`ps eww -p ${pid} 2>/dev/null`, { timeout: 3000, encoding: 'utf8' });
        const csrfM = env.match(/WINDSURF_CSRF_TOKEN=([^\s]+)/);
        if (csrfM) csrf = csrfM[1];
      } else {
        const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
        const csrfM = env.match(/WINDSURF_CSRF_TOKEN=([^\0]+)/);
        if (csrfM) csrf = csrfM[1];
      }
    } catch {}
    if (!csrf) continue;

    // 提取版本号
    let ver = '2.2.17';
    const verM = cmdLine.match(/--windsurf_version\s+([\d.]+)/);
    if (verM) ver = verM[1];

    // 提取 extension_server_port（排除用）
    let extPort = '';
    const extM = cmdLine.match(/--extension_server_port\s+(\d+)/);
    if (extM) extPort = extM[1];

    // 查找 gRPC 端口
    try {
      const lsofOut = execSync(`lsof -i -P -n -p ${pid} 2>/dev/null | grep LISTEN`, {
        timeout: 5000, encoding: 'utf8',
      }).trim();
      for (const ll of lsofOut.split('\n')) {
        const pm = ll.match(/:(\d+)\s.*LISTEN/);
        if (pm && pm[1] !== extPort) {
          results.push({ port: parseInt(pm[1], 10), csrf, ideVersion: ver, ts: Date.now() });
        }
      }
    } catch {}
  }
  return results;
}

/** 获取一个可用的 LS 实例（带缓存） */
function getLsInfo(): LsInfo | null {
  if (_lsCache && Date.now() - _lsCache.ts < LS_CACHE_TTL_MS) {
    return _lsCache;
  }
  const instances = discoverLsInstances();
  if (instances.length === 0) {
    _lsCache = null;
    return null;
  }
  _lsCache = instances[0];
  return _lsCache;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitTcpPort(port: number, timeoutMs = 25000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve();
      });
      const retry = () => {
        sock.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error(`隔离 LS 端口 ${port} 未就绪`));
        else setTimeout(tryOnce, 500);
      };
      sock.on('error', retry);
      sock.setTimeout(1000, retry);
    };
    tryOnce();
  });
}

/** 自动发现 Windsurf LS 二进制路径（跨平台） */
function findLsBinary(): string {
  const platform = process.platform;
  const arch = process.arch;

  // 平台对应的二进制文件名
  let binName: string;
  if (platform === 'win32') {
    binName = 'language_server_windows_x64.exe';
  } else if (platform === 'darwin') {
    binName = arch === 'arm64' ? 'language_server_macos_arm' : 'language_server_macos_x64';
  } else {
    binName = 'language_server_linux_x64';
  }

  // 策略 1：从运行中的 LS 进程获取路径
  try {
    if (platform === 'win32') {
      const out = execSync(
        `wmic process where "name='${binName}'" get ExecutablePath /FORMAT:LIST`,
        { timeout: 5000, encoding: 'utf8', windowsHide: true }
      ).trim();
      const match = out.match(/ExecutablePath=(.+)/);
      if (match && match[1]?.trim() && fs.existsSync(match[1].trim())) return match[1].trim();
    } else {
      const lsSearch = platform === 'darwin' ? 'language_server_' : 'language_server_linux';
      const out = execSync(`ps -eo args 2>/dev/null | grep '${lsSearch}' | grep -v grep | head -1`, {
        timeout: 3000, encoding: 'utf8',
      }).trim();
      const bin = out.split(/\s+/)[0];
      if (bin && fs.existsSync(bin)) return bin;
    }
  } catch {}

  // 策略 2：从 Windsurf 可执行文件路径推算
  const execDir = path.dirname(process.execPath);
  const candidates: string[] = [];

  if (platform === 'win32') {
    candidates.push(
      path.join(execDir, 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
    );
    // 常见安装路径兜底（Devin + Windsurf）
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      candidates.push(
        path.join(localAppData, 'Programs', 'Devin', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
        path.join(localAppData, 'Programs', 'Windsurf', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
        path.join(localAppData, 'Programs', 'Windsurf - Next', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
      );
    }
  } else if (platform === 'darwin') {
    // /Applications/Devin.app/Contents/MacOS/Electron → …/Contents/Resources/app/extensions/…
    const contentsDir = execDir.replace(/\/MacOS$/, '').replace(/\/Frameworks\/.+$/, '');
    // 新命名 + 旧命名兜底
    const altBins = arch === 'arm64'
      ? ['language_server_macos_x64', 'language_server_darwin_arm64', 'language_server_darwin_x64']
      : ['language_server_macos_arm', 'language_server_darwin_x64', 'language_server_darwin_arm64'];
    const extDirs = ['windsurf', 'windsurf-next'];
    const appBases = [
      contentsDir,
      '/Applications/Devin.app/Contents',
      '/Applications/Windsurf.app/Contents',
      '/Applications/Windsurf - Next.app/Contents',
      path.join(process.env.HOME || os.homedir(), 'Applications', 'Devin.app', 'Contents'),
      path.join(process.env.HOME || os.homedir(), 'Applications', 'Windsurf.app', 'Contents'),
      path.join(process.env.HOME || os.homedir(), 'Applications', 'Windsurf - Next.app', 'Contents'),
    ];
    for (const base of appBases) {
      for (const ext of extDirs) {
        candidates.push(path.join(base, 'Resources', 'app', 'extensions', ext, 'bin', binName));
        for (const alt of altBins) {
          candidates.push(path.join(base, 'Resources', 'app', 'extensions', ext, 'bin', alt));
        }
      }
    }
    // 策略 3：find 命令兜底搜索
    try {
      const found = execSync(
        `find /Applications -maxdepth 6 \( -name '${binName}' -o -name 'language_server_darwin*' -o -name 'language_server_macos*' \) -type f 2>/dev/null | head -1`,
        { timeout: 5000, encoding: 'utf8' }
      ).trim();
      if (found && fs.existsSync(found)) return found;
    } catch {}
  } else {
    candidates.push(
      path.join(execDir, 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
    );
    // 常见安装路径兜底（Devin + Windsurf）
    candidates.push(
      `/usr/share/devin/resources/app/extensions/windsurf/bin/${binName}`,
      `/opt/devin/resources/app/extensions/windsurf/bin/${binName}`,
      path.join(process.env.HOME || '', '.local', 'share', 'devin', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
      `/usr/share/windsurf/resources/app/extensions/windsurf/bin/${binName}`,
      `/opt/windsurf/resources/app/extensions/windsurf/bin/${binName}`,
      path.join(process.env.HOME || '', '.local', 'share', 'windsurf', 'resources', 'app', 'extensions', 'windsurf', 'bin', binName),
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error(`找不到 IDE LS 二进制文件，已尝试路径: ${candidates.join(', ')}`);
}

async function getIsolatedLsInfo(): Promise<LsInfo> {
  if (_isolatedLs && _isolatedLs.proc && !_isolatedLs.proc.killed) return _isolatedLs;

  const bin = findLsBinary();
  const port = await getFreePort();
  const csrf = `windsurf-pool-${crypto.randomUUID()}`;
  const root = path.join(os.tmpdir(), `windsurf-pool-isolated-ls-${process.pid}-${crypto.randomUUID()}`);
  const db = path.join(root, 'db');
  fs.mkdirSync(db, { recursive: true });

  // 用户目录：跨平台
  const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();

  const args = [
    '--api_server_url', 'https://server.self-serve.windsurf.com',
    '--run_child',
    '--enable_lsp',
    '--ide_name', 'windsurf',
    '--server_port', String(port),
    '--csrf_token', csrf,
    '--inference_api_server_url', 'https://inference.codeium.com',
    '--register_user_url', 'https://api.codeium.com/register_user/',
    '--codeium_dir', root,
    '--database_dir', db,
    '--enable_index_service',
    '--enable_local_search',
    '--search_max_workspace_file_count', '5000',
    '--indexed_files_retention_period_days', '30',
    '--workspace_id', 'windsurf_pool_isolated_probe',
    '--sentry_telemetry',
    '--sentry_environment', 'stable',
    '--extensions_dir', getExtensionsDirBase(homeDir),
    '--windsurf_version', getIdeVersion(),
    '--detect_proxy=false',
  ];

  const ideVersion = getIdeVersion();
  const proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  _isolatedLs = { port, csrf, ideVersion, ts: Date.now(), isolated: true, root, proc };
  proc.on('exit', () => {
    if (_isolatedLs?.proc === proc) _isolatedLs = null;
  });

  await waitTcpPort(port);
  return _isolatedLs;
}

export function stopIsolatedCascadeProbeLs(): void {
  const cur = _isolatedLs;
  _isolatedLs = null;
  if (cur?.proc && !cur.proc.killed) {
    try { cur.proc.kill(); } catch {}
  }
  if (cur?.root) {
    try { fs.rmSync(cur.root, { recursive: true, force: true }); } catch {}
  }
}

// ── LS Pool: 满载滕动回收模式 ──

/**
 * 启动 LS 实例池。
 * @param poolSize 池大小（= 并发数，1:1）
 * @returns 实际启动成功的 LS 数
 */
export async function startLsPool(poolSize: number): Promise<number> {
  stopLsPool();
  _lsPoolTargetSize = Math.max(1, poolSize);
  const results = await Promise.allSettled(
    Array.from({ length: _lsPoolTargetSize }, () => spawnOneLs())
  );
  for (const r of results) {
    if (r.status === 'fulfilled') _lsPool.push(r.value);
  }
  return _lsPool.length;
}

/**
 * 从池中获取一个空闲且未耗尽的 LS。
 * 若所有空闲 LS 均已耗尽，自动回收并补充新 LS。
 */
export async function acquireLs(timeoutMs = 60000): Promise<LsInfo | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // 优先找空闲且未耗尽的 LS，验证端口存活
    const candidates = _lsPool.filter(ls =>
      !_lsPoolBusy.has(ls) && ls.proc && !ls.proc.killed &&
      (_lsProbeCount.get(ls) || 0) < MAX_PROBES_PER_LS
    );
    let foundAlive = false;
    for (const ls of candidates) {
      const alive = await checkPortAlive(ls.port);
      if (alive) {
        _lsPoolBusy.add(ls);
        _lsProbeCount.set(ls, (_lsProbeCount.get(ls) || 0) + 1);
        return ls;
      }
      // 端口已死，立即回收
      recycleLs(ls);
      foundAlive = false;
    }
    // 有候选但全死了，补充新 LS
    if (candidates.length > 0 && !foundAlive && !_recyclePromise) {
      _recyclePromise = (async () => {
        const deficit = _lsPoolTargetSize - _lsPool.filter(l => l.proc && !l.proc.killed).length;
        if (deficit > 0) {
          const results = await Promise.allSettled(
            Array.from({ length: deficit }, () => spawnOneLs())
          );
          for (const r of results) {
            if (r.status === 'fulfilled') _lsPool.push(r.value);
          }
        }
      })().finally(() => { _recyclePromise = null; });
      await _recyclePromise;
      continue;
    }

    // 回收耗尽的空闲 LS 并补充新 LS（加锁防止多 worker 并发重复 spawn）
    if (!_recyclePromise) {
      const exhaustedIdle = _lsPool.filter(ls =>
        !_lsPoolBusy.has(ls) && (_lsProbeCount.get(ls) || 0) >= MAX_PROBES_PER_LS
      );
      if (exhaustedIdle.length > 0) {
        _recyclePromise = (async () => {
          for (const ls of exhaustedIdle) {
            recycleLs(ls);
          }
          const deficit = _lsPoolTargetSize - _lsPool.filter(l => l.proc && !l.proc.killed).length;
          if (deficit > 0) {
            const results = await Promise.allSettled(
              Array.from({ length: deficit }, () => spawnOneLs())
            );
            for (const r of results) {
              if (r.status === 'fulfilled') _lsPool.push(r.value);
            }
          }
        })().finally(() => { _recyclePromise = null; });
      }
    }
    // 等待回收完成或短暂等待
    if (_recyclePromise) {
      await _recyclePromise;
      continue;
    }

    // 所有 LS 都在忙，等待
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

/** 归还 LS 到池 */
export function releaseLs(ls: LsInfo): void {
  _lsPoolBusy.delete(ls);
}

/** 回收单个 LS（杀死进程 + 清理临时目录，幂等） */
const _recycledSet = new WeakSet<LsInfo>();
function recycleLs(ls: LsInfo): void {
  if (_recycledSet.has(ls)) return; // 幂等：防止 proc.on('exit') 和多 worker 重复回收
  _recycledSet.add(ls);
  const idx = _lsPool.indexOf(ls);
  if (idx >= 0) _lsPool.splice(idx, 1);
  _lsPoolBusy.delete(ls);
  _lsProbeCount.delete(ls);
  if (ls.proc && !ls.proc.killed) try { ls.proc.kill(); } catch {}
  if (ls.root) try { fs.rmSync(ls.root, { recursive: true, force: true }); } catch {}
}

/** 停止并清理整个 LS 池 */
export function stopLsPool(): void {
  for (const ls of _lsPool) {
    if (ls.proc && !ls.proc.killed) try { ls.proc.kill(); } catch {}
    if (ls.root) try { fs.rmSync(ls.root, { recursive: true, force: true }); } catch {}
  }
  _lsPool.length = 0;
  _lsPoolBusy.clear();
  _lsProbeCount.clear();
}

/** 当前 LS 池大小 */
export function getLsPoolSize(): number {
  return _lsPool.filter(ls => ls.proc && !ls.proc.killed).length;
}

async function spawnOneLs(): Promise<LsInfo> {
  const bin = findLsBinary();
  const port = await getFreePort();
  const csrf = `windsurf-pool-${crypto.randomUUID()}`;
  const root = path.join(os.tmpdir(), `windsurf-pool-ls-pool-${process.pid}-${crypto.randomUUID()}`);
  const db = path.join(root, 'db');
  fs.mkdirSync(db, { recursive: true });
  const homeDir = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const args = [
    '--api_server_url', 'https://server.self-serve.windsurf.com',
    '--run_child',
    '--enable_lsp',
    '--ide_name', 'windsurf',
    '--server_port', String(port),
    '--csrf_token', csrf,
    '--inference_api_server_url', 'https://inference.codeium.com',
    '--register_user_url', 'https://api.codeium.com/register_user/',
    '--codeium_dir', root,
    '--database_dir', db,
    '--enable_index_service',
    '--enable_local_search',
    '--search_max_workspace_file_count', '5000',
    '--indexed_files_retention_period_days', '30',
    '--workspace_id', `windsurf_pool_ls_pool_${port}`,
    '--sentry_telemetry',
    '--sentry_environment', 'stable',
    '--extensions_dir', getExtensionsDirBase(homeDir),
    '--windsurf_version', getIdeVersion(),
    '--detect_proxy=false',
  ];
  const ideVersion = getIdeVersion();
  const proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  const ls: LsInfo = { port, csrf, ideVersion, ts: Date.now(), isolated: true, root, proc };
  proc.on('exit', () => {
    recycleLs(ls); // 统一走 recycleLs（幂等，不会重复 splice/kill）
  });
  await waitTcpPort(port);
  return ls;
}

/** 强制清除缓存（例如端口变化时） */
export function invalidateLsCache(): void {
  _lsCache = null;
}

// ── Cascade Canary Probe ──

export interface CascadeProbeResult {
  rateLimited: boolean;
  error?: string;
  detail?: string;
  reply?: string;
  limitKind?: 'overall' | 'message' | 'model' | 'rate' | 'unknown';
  resetText?: string;
  traceId?: string;
}

/**
 * 通过本地 LS 的 Cascade 协议发送 canary 消息，检测账号是否被限速。
 *
 * 流程：
 * 1. StartCascade — 创建会话
 * 2. SendUserCascadeMessage — 触发模型调用
 * 3. GetCascadeTrajectorySteps — 轮询结果（最多 5 次，每次 2s）
 *
 * 如果返回 ERROR_MESSAGE 且包含 "rate limit" → rateLimited=true
 * 如果 LS 不可用或探测失败 → rateLimited=false, error=...
 */
function extractReplyText(steps: any[]): string {
  for (const step of steps) {
    if (String(step.type || '').includes('USER_INPUT')) continue;
    const plannerText = step?.plannerResponse?.modifiedResponse || step?.plannerResponse?.response;
    if (plannerText) {
      return String(plannerText).replace(/\s+/g, ' ').trim().slice(0, 800);
    }
    const raw = JSON.stringify(step);
    const matches = [...raw.matchAll(/"(?:text|markdown|content|message|response|modifiedResponse)"\s*:\s*"([^"]{2,1200})"/g)];
    for (const m of matches) {
      const text = m[1]
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();
      if (text && !/^(DONE|RUNNING|PLANNER_RESPONSE|ERROR_MESSAGE)$/i.test(text)) {
        return text.slice(0, 800);
      }
    }
  }
  return '';
}

function decodeGrpcMessageText(text: string): string {
  try {
    return decodeURIComponent(text || '');
  } catch {
    return text || '';
  }
}

function classifyRateLimitMessage(message: string): Pick<CascadeProbeResult, 'limitKind' | 'resetText' | 'traceId'> {
  const text = decodeGrpcMessageText(message || '');
  const trace = text.match(/trace\s*id\s*[:：]\s*([a-z0-9-]+)/i)?.[1]
    || text.match(/跟踪\s*ID\s*[:：]\s*([a-z0-9-]+)/i)?.[1];
  const reset = text.match(/resets?\s+in\s*[:：]?\s*([0-9a-zA-Z\s]+?)(?:[).]|$)/i)?.[1]?.trim()
    || text.match(/重置(?:时间)?\s*[:：]?\s*([0-9一二三四五六七八九十百千万\s分钟小时秒]+?)(?:[).。]|$)/i)?.[1]?.trim();

  let limitKind: CascadeProbeResult['limitKind'] = 'unknown';
  if (/overall\s+message\s+rate\s+limit|overall\s+rate\s+limit/i.test(text)) {
    limitKind = 'overall';
  } else if (/message\s+rate\s+limit|message\s+limit/i.test(text)) {
    limitKind = 'message';
  } else if (/for this model|model.*rate\s+limit/i.test(text)) {
    limitKind = 'model';
  } else if (/rate\s+limit/i.test(text)) {
    limitKind = 'rate';
  }

  return { limitKind, resetText: reset, traceId: trace };
}

export async function cascadeProbe(apiKey: string, modelUid = 'MODEL_SWE_1_5', isolated = true, probeText = '你好', lsOverride?: LsInfo): Promise<CascadeProbeResult> {
  // 全局频率限制：防止同一 IP 短时间内发大量 cascade 请求导致 IP 级限速
  await waitForProbeSlot();

  const ls = lsOverride || (isolated ? await getIsolatedLsInfo().catch((e: any) => {
    throw e;
  }) : getLsInfo());
  if (!ls) {
    return { rateLimited: false, error: 'LS 不可用（未找到本地语言服务器）' };
  }

  const meta = {
    ideName: 'windsurf',
    ideVersion: ls.ideVersion,
    extensionName: 'windsurf-next',
    extensionVersion: ls.ideVersion,
    apiKey,
  };

  const convId = crypto.randomUUID();
  const messageText = (probeText || '你好').trim().slice(0, 200) || '你好';

  // Step 1: StartCascade
  let cascadeId: string;
  try {
    const r = await grpcPost(ls.port, ls.csrf, `${LS_SERVICE}/StartCascade`, {
      metadata: meta,
      chatMessages: [{
        messageId: crypto.randomUUID(),
        conversationId: convId,
        source: 1,
        prompt: messageText,
        timestamp: new Date().toISOString(),
      }],
    });
    if (r.grpcStatus && r.grpcStatus !== '0') {
      // CSRF 失效时清缓存
      if (r.grpcStatus === '16') { invalidateLsCache(); }
      return { rateLimited: false, error: `StartCascade gRPC ${r.grpcStatus}: ${decodeURIComponent(r.grpcMsg)}` };
    }
    cascadeId = r.json?.cascadeId;
    if (!cascadeId) {
      return { rateLimited: false, error: 'StartCascade 未返回 cascadeId' };
    }
  } catch (e: any) {
    invalidateLsCache();
    return { rateLimited: false, error: `StartCascade: ${e.message}` };
  }

  // Step 2: SendUserCascadeMessage
  try {
    const r = await grpcPost(ls.port, ls.csrf, `${LS_SERVICE}/SendUserCascadeMessage`, {
      metadata: meta,
      cascadeId,
      items: [{ text: messageText }],
      cascadeConfig: {
        plannerConfig: {
          plannerTypeConfig: { conversational: {} },
          requestedModelUid: modelUid,
          planModelUid: modelUid,
        },
      },
    });
    if (r.grpcStatus && r.grpcStatus !== '0') {
      return { rateLimited: false, error: `SendMessage gRPC ${r.grpcStatus}: ${decodeURIComponent(r.grpcMsg)}` };
    }
  } catch (e: any) {
    return { rateLimited: false, error: `SendMessage: ${e.message}` };
  }

  // Step 3: Poll GetCascadeTrajectorySteps
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const r = await grpcPost(ls.port, ls.csrf, `${LS_SERVICE}/GetCascadeTrajectorySteps`, {
        metadata: meta,
        cascadeId,
      });
      if (r.grpcStatus && r.grpcStatus !== '0') {
        return { rateLimited: false, error: `Poll gRPC ${r.grpcStatus}: ${decodeURIComponent(r.grpcMsg)}` };
      }

      const steps: any[] = r.json?.steps || [];

      // 检查 ERROR_MESSAGE 步骤
      const errStep = steps.find((s: any) => s.type?.includes('ERROR'));
      if (errStep) {
        const errMsg = errStep.errorMessage?.error?.userErrorMessage || JSON.stringify(errStep.errorMessage || {});
        const isRateLimit = /rate.?limit|overall.?message/i.test(errMsg);
        const classified = isRateLimit ? classifyRateLimitMessage(errMsg) : {};
        return {
          rateLimited: isRateLimit,
          error: isRateLimit ? undefined : errMsg,
          detail: errMsg,
          ...classified,
        };
      }

      // 检查 PLANNER_RESPONSE DONE — 正常回复
      const plannerDone = steps.find((s: any) =>
        s.type?.includes('PLANNER_RESPONSE') && s.status?.includes('DONE')
      );
      if (plannerDone) {
        return { rateLimited: false, reply: extractReplyText(steps) };
      }

    } catch (e: any) {
      return { rateLimited: false, error: `Poll: ${e.message}` };
    }
  }

  return { rateLimited: false, error: '探测超时（30s 未拿到模型回复）' };
}
