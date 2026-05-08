import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as os from 'os';
import { getPoolRoot, getAppDataDir, ensureDir, isWindows, isMac } from './utils';
import { CACHE_TTL } from './config';

// ─── 类型 ───────────────────────────────────────────────

export type InstanceSource = 'local' | 'cockpit';

export interface InstanceConfig {
  id: string;
  name: string;
  userDataDir: string;
  bindAccountId: string;   // email
  bindEmail: string;
  createdAt: number;
  lastPid?: number;
  source?: InstanceSource;  // 默认 local，cockpit 表示引用 Cockpit Tools 目录
  assignedTag?: string;     // 分配的账号标签（切号范围）
}

export interface InstanceView extends InstanceConfig {
  running: boolean;
  current: boolean;  // 是否为当前 windsurf-pool 所在窗口对应的实例
}

interface InstanceStore {
  instances: InstanceConfig[];
}

// ─── 常量 ───────────────────────────────────────────────

const INSTANCES_DIR_NAME = 'instances';
const INSTANCES_FILE = 'instances.json';
const BIND_FILE = '.windsurf-pool-bind';
const COPY_EXCLUDE = ['GPUCache', 'Cache', 'CachedData', 'Code Cache', 'blob_storage', 'Crashpad', 'logs', 'Crash Reports'];

// ─── 路径 ───────────────────────────────────────────────

function getInstancesRoot(): string {
  return path.join(getPoolRoot(), INSTANCES_DIR_NAME);
}

function getInstancesFilePath(): string {
  return path.join(getPoolRoot(), INSTANCES_FILE);
}

function getDefaultUserDataDir(): string {
  const appDataDir = getAppDataDir();
  // 优先检测实际存在的目录，兼容 Windsurf / Windsurf - Next
  const candidates = [
    path.join(appDataDir, 'Windsurf'),
    path.join(appDataDir, 'Windsurf - Next'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];  // 默认返回 Windsurf
}

// ─── Store 读写 ─────────────────────────────────────────

let _storeCache: InstanceStore | null = null;
let _storeCacheTs = 0;

function loadStore(forceFresh = false): InstanceStore {
  const now = Date.now();
  if (!forceFresh && _storeCache && now - _storeCacheTs < CACHE_TTL.INSTANCES) {
    return _storeCache;
  }
  const p = getInstancesFilePath();
  if (!fs.existsSync(p)) { return { instances: [] }; }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    _storeCache = { instances: Array.isArray(parsed.instances) ? parsed.instances : [] };
    _storeCacheTs = now;
    return _storeCache;
  } catch {
    return { instances: [] };
  }
}

function saveStore(store: InstanceStore): void {
  ensureDir(getPoolRoot());
  const p = getInstancesFilePath();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, p);
  _storeCache = store;
  _storeCacheTs = Date.now();
}

// ─── 文件监听（多实例同步）──────────────────────────────

let instanceFileWatcher: fs.FSWatcher | null = null;
const instanceChangeListeners: Set<() => void> = new Set();

function startInstanceWatcher(): void {
  if (instanceFileWatcher) return;
  try {
    ensureDir(getPoolRoot());
    instanceFileWatcher = fs.watch(getPoolRoot(), (_evt, filename) => {
      if (!filename || filename === INSTANCES_FILE) {
        _storeCache = null; // 失效缓存
        for (const fn of instanceChangeListeners) {
          try { fn(); } catch { /* ignore */ }
        }
      }
    });
    instanceFileWatcher.on('error', (err) => {
      console.warn('[instanceManager] watcher 出错，将重试:', err);
      try { instanceFileWatcher?.close(); } catch { /* ignore */ }
      instanceFileWatcher = null;
      setTimeout(() => { if (instanceChangeListeners.size > 0) startInstanceWatcher(); }, 1000);
    });
  } catch (e) {
    console.warn('[instanceManager] watch 失败:', e);
  }
}

export function watchInstancesFile(onChange: () => void): () => void {
  instanceChangeListeners.add(onChange);
  startInstanceWatcher();
  return () => {
    instanceChangeListeners.delete(onChange);
    if (instanceChangeListeners.size === 0 && instanceFileWatcher) {
      try { instanceFileWatcher.close(); } catch { /* ignore */ }
      instanceFileWatcher = null;
    }
  };
}

// ─── 实例 CRUD ──────────────────────────────────────────

function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** 判断路径是否在某个前缀目录内（安全校验） */
function isPathUnder(target: string, base: string): boolean {
  const rel = path.relative(base, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function listInstances(): Promise<InstanceView[]> {
  const store = loadStore();

  // 确保默认实例始终出现在列表中（安全包裹，绝不影响主流程）
  try { ensureDefaultInstance(store); } catch (e) {
    console.warn('[instanceManager] ensureDefaultInstance failed:', e);
  }

  const runningDirs = await getRunningInstanceDirs();
  const currentDir = normalizePath(getCurrentUserDataDir());
  return store.instances.map(inst => {
    const normDir = normalizePath(inst.userDataDir);
    return {
      ...inst,
      running: runningDirs.has(normDir),
      current: normDir === currentDir
    };
  });
}

/** 确保默认 Windsurf 实例在 store 中，首次自动添加 */
function ensureDefaultInstance(store: InstanceStore): void {
  const defaultDir = getDefaultUserDataDir();
  if (!defaultDir || !fs.existsSync(defaultDir)) return;

  const normDefault = normalizePath(defaultDir);
  if (store.instances.some(i => normalizePath(i.userDataDir) === normDefault)) return;

  const bindEmail = readBindMark(defaultDir) || '';
  store.instances.unshift({
    id: 'default',
    name: '默认实例',
    userDataDir: defaultDir,
    bindAccountId: bindEmail,
    bindEmail,
    createdAt: 0,
    source: 'local'
  });
  saveStore(store);
}

/** 将当前窗口的活跃账号同步到 instances.json（供其他窗口读取） */
export function syncCurrentInstanceEmail(email: string): void {
  if (!email) return;
  const store = loadStore();
  const currentDir = normalizePath(getCurrentUserDataDir());
  const inst = store.instances.find(i => normalizePath(i.userDataDir) === currentDir);
  if (inst && inst.bindEmail !== email) {
    inst.bindEmail = email;
    inst.bindAccountId = email;
    saveStore(store);
  }
}

export interface CreateInstanceOptions {
  name: string;
  bindEmail: string;
  onProgress?: (msg: string) => void;
}

export async function createInstance(opts: CreateInstanceOptions): Promise<InstanceConfig> {
  const store = loadStore();

  const name = opts.name.trim();
  if (!name) { throw new Error('实例名称不能为空'); }
  if (store.instances.some(i => i.name === name)) { throw new Error('实例名称已存在'); }

  const id = generateId();
  const instanceDir = path.join(getInstancesRoot(), id);

  if (fs.existsSync(instanceDir)) { throw new Error('实例目录已存在'); }

  // 复制默认 user-data-dir
  const sourceDir = getDefaultUserDataDir();
  if (!fs.existsSync(sourceDir)) { throw new Error('默认 Windsurf 数据目录不存在'); }

  opts.onProgress?.('正在统计文件…');
  const total = countFiles(sourceDir);

  const progress: CopyProgress = {
    copied: 0,
    total,
    onProgress: opts.onProgress,
    lastReportTs: 0
  };
  opts.onProgress?.(`复制中… 0/${total} (0%)`);
  await copyDirSelective(sourceDir, instanceDir, progress);

  // 写入绑定标记
  const bindData = { bindEmail: opts.bindEmail };
  fs.writeFileSync(path.join(instanceDir, BIND_FILE), JSON.stringify(bindData), 'utf8');

  const instance: InstanceConfig = {
    id,
    name,
    userDataDir: instanceDir,
    bindAccountId: opts.bindEmail,
    bindEmail: opts.bindEmail,
    createdAt: Date.now(),
    source: 'local'
  };

  store.instances.push(instance);
  saveStore(store);
  opts.onProgress?.('实例创建完成');
  return instance;
}

export function deleteInstance(instanceId: string): void {
  if (instanceId === 'default') { throw new Error('默认实例不可删除'); }

  const store = loadStore();
  const idx = store.instances.findIndex(i => i.id === instanceId);
  if (idx < 0) { throw new Error('实例不存在'); }

  const inst = store.instances[idx];

  // Cockpit 导入的实例：只移除绑定标记和 store 记录，保留原目录
  if (inst.source === 'cockpit') {
    try {
      const bindPath = path.join(inst.userDataDir, BIND_FILE);
      if (fs.existsSync(bindPath)) { fs.unlinkSync(bindPath); }
    } catch (e) {
      console.warn('[instanceManager] 移除绑定标记失败:', e);
    }
  } else {
    // 本地实例：严格校验路径必须在 instances 根目录下，避免误删默认目录
    const instancesRoot = getInstancesRoot();
    if (!isPathUnder(inst.userDataDir, instancesRoot)) {
      console.error('[instanceManager] 路径安全校验失败，拒绝删除:', inst.userDataDir);
      // 仅从 store 移除记录，不删除目录
    } else {
      try {
        if (fs.existsSync(inst.userDataDir)) {
          fs.rmSync(inst.userDataDir, { recursive: true, force: true });
        }
      } catch (e) {
        console.warn('[instanceManager] 删除实例目录失败:', e);
      }
    }
  }

  store.instances.splice(idx, 1);
  saveStore(store);
}

export function updateInstanceBind(instanceId: string, bindEmail: string): void {
  const store = loadStore();
  const inst = store.instances.find(i => i.id === instanceId);
  if (!inst) { throw new Error('实例不存在'); }
  inst.bindAccountId = bindEmail;
  inst.bindEmail = bindEmail;
  // 更新标记文件
  const bindPath = path.join(inst.userDataDir, BIND_FILE);
  fs.writeFileSync(bindPath, JSON.stringify({ bindEmail }), 'utf8');
  saveStore(store);
}

export function updateInstanceName(instanceId: string, newName: string): void {
  const store = loadStore();
  const inst = store.instances.find(i => i.id === instanceId);
  if (!inst) { throw new Error('实例不存在'); }
  const name = newName.trim();
  if (!name) { throw new Error('实例名称不能为空'); }
  if (store.instances.some(i => i.id !== instanceId && i.name === name)) { throw new Error('实例名称已存在'); }
  inst.name = name;
  saveStore(store);
}

export function updateInstanceTag(instanceId: string, tag: string | undefined): void {
  const store = loadStore();
  const inst = store.instances.find(i => i.id === instanceId);
  if (!inst) { throw new Error('实例不存在'); }
  inst.assignedTag = tag || undefined;
  saveStore(store);
}

export function getCurrentInstanceTag(): string | undefined {
  const store = loadStore();
  const currentDir = normalizePath(getCurrentUserDataDir());
  const inst = store.instances.find(i => normalizePath(i.userDataDir) === currentDir);
  return inst?.assignedTag;
}

export function getCurrentInstanceName(): string {
  const store = loadStore();
  const currentDir = normalizePath(getCurrentUserDataDir());
  const inst = store.instances.find(i => normalizePath(i.userDataDir) === currentDir);
  return inst?.name || '默认实例';
}

// ─── 启动 / 停止 ───────────────────────────────────────

// Windsurf.exe 路径检测结果缓存（进程内）
let _exePathCache: { path: string | null; ts: number } | null = null;

async function detectWindsurfExePath(): Promise<string | null> {
  // 命中缓存（且文件仍存在）
  if (_exePathCache && Date.now() - _exePathCache.ts < CACHE_TTL.EXE_PATH) {
    if (!_exePathCache.path || fs.existsSync(_exePathCache.path)) {
      return _exePathCache.path;
    }
  }

  const found = await doDetectWindsurfExePath();
  _exePathCache = { path: found, ts: Date.now() };
  return found;
}

async function doDetectWindsurfExePath(): Promise<string | null> {
  if (isWindows) {
    return doDetectWindsurfExePathWindows();
  }
  return doDetectWindsurfExePathUnix();
}

async function doDetectWindsurfExePathWindows(): Promise<string | null> {
  // 1. 从已运行的 Windsurf 进程取 exe 路径（异步，不阻塞）
  const entries = await getRunningWindsurfEntries();
  for (const [pid] of entries) {
    const out = await runPowerShellAsync(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`, 3000);
    const exePath = out?.trim().split(/\r?\n/).find(l => l.toLowerCase().endsWith('windsurf.exe'));
    if (exePath && fs.existsSync(exePath)) return exePath;
  }

  // 2. 常见安装路径（最快，先于注册表）
  const userProfile = process.env.USERPROFILE || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe'),
    path.join(localAppData, 'Programs', 'Windsurf - Next', 'Windsurf.exe'),
    'C:\\Program Files\\Windsurf\\Windsurf.exe',
    'C:\\Program Files (x86)\\Windsurf\\Windsurf.exe',
    path.join(userProfile, 'scoop', 'apps', 'windsurf', 'current', 'Windsurf.exe'),
    'D:\\Program Files\\Windsurf\\Windsurf.exe',
    'D:\\Program\\Windsurf\\Windsurf.exe',
    'E:\\Program Files\\Windsurf\\Windsurf.exe',
    'E:\\Program\\Windsurf\\Windsurf.exe',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) { return c; }
  }

  // 3. PowerShell 查询卸载注册表（更快，只查 DisplayName 含 Windsurf 的项）
  const psReg = `
$paths = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like '*Windsurf*' -and $_.InstallLocation } |
  Select-Object -First 1 -ExpandProperty InstallLocation
`.trim();
  const regOut = await runPowerShellAsync(psReg, 5000);
  if (regOut) {
    const installDir = regOut.split(/\r?\n/).find(l => l.trim());
    if (installDir) {
      const exe = path.join(installDir.trim(), 'Windsurf.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }

  // 4. PATH 环境变量
  try {
    const out = cp.execSync('where Windsurf.exe', {
      encoding: 'utf8', timeout: 3000, windowsHide: true
    });
    const first = out.split('\n').map(l => l.trim()).find(l => l && fs.existsSync(l));
    if (first) return first;
  } catch { /* ignore */ }

  return null;
}

async function doDetectWindsurfExePathUnix(): Promise<string | null> {
  const home = os.homedir();

  // 1. 常见安装路径
  const candidates = isMac
    ? [
        '/Applications/Windsurf.app/Contents/MacOS/Electron',
        path.join(home, 'Applications', 'Windsurf.app', 'Contents', 'MacOS', 'Electron'),
      ]
    : [
        '/usr/bin/windsurf',
        '/usr/local/bin/windsurf',
        '/snap/bin/windsurf',
        path.join(home, '.local', 'bin', 'windsurf'),
        '/opt/Windsurf/windsurf',
        '/opt/windsurf/windsurf',
        '/usr/share/windsurf/windsurf',
        '/usr/lib/windsurf/windsurf',
        path.join(home, '.local', 'opt', 'windsurf', 'windsurf'),
      ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // 2. which 查询 PATH
  try {
    const out = cp.execSync('which windsurf', {
      encoding: 'utf8', timeout: 3000
    });
    const found = out.trim();
    if (found && fs.existsSync(found)) return found;
  } catch { /* ignore */ }

  return null;
}

export async function startInstance(instanceId: string, onLog?: (msg: string) => void): Promise<void> {
  const log = onLog || (() => {});

  const store = loadStore();
  const inst = store.instances.find(i => i.id === instanceId);
  if (!inst) { throw new Error('实例不存在'); }

  // 校验数据目录是否存在
  if (!fs.existsSync(inst.userDataDir)) {
    throw new Error(`实例数据目录不存在: ${inst.userDataDir}`);
  }

  // 避免重复启动
  const runningDirs = await getRunningInstanceDirs();
  if (runningDirs.has(normalizePath(inst.userDataDir))) {
    throw new Error(`实例 "${inst.name}" 已在运行`);
  }

  const exePath = await detectWindsurfExePath();
  if (!exePath) {
    throw new Error('未找到 Windsurf 可执行文件。请确认已安装 Windsurf，或将其加入 PATH 环境变量');
  }

  // 通过 CLI 模式启动：ELECTRON_RUN_AS_NODE=1 + cli.js
  // 直接 spawn Windsurf.exe 会被 Electron 单实例锁拦截（exit code 9）
  // Linux: exePath 可能是 symlink（如 /usr/bin/windsurf → /usr/share/windsurf/bin/windsurf），需要解析真实路径
  let realExePath = exePath;
  try { realExePath = fs.realpathSync(exePath); } catch { /* ignore */ }
  const exeDir = path.dirname(exePath);
  const realExeDir = path.dirname(realExePath);
  const cliJsCandidates: string[] = isMac
    ? [path.join(exeDir, '..', 'Resources', 'app', 'out', 'cli.js')]
    : isWindows
      ? [path.join(exeDir, 'resources', 'app', 'out', 'cli.js')]
      : [
          // 直接相对于 exe 目录
          path.join(exeDir, 'resources', 'app', 'out', 'cli.js'),
          // 解析 symlink 后的真实路径（../resources 常见于 bin/ 子目录）
          path.join(realExeDir, 'resources', 'app', 'out', 'cli.js'),
          path.join(realExeDir, '..', 'resources', 'app', 'out', 'cli.js'),
          // 已知的 Linux 安装目录
          '/usr/share/windsurf/resources/app/out/cli.js',
          '/usr/lib/windsurf/resources/app/out/cli.js',
          '/opt/windsurf/resources/app/out/cli.js',
          '/opt/Windsurf/resources/app/out/cli.js',
          path.join(os.homedir(), '.local', 'opt', 'windsurf', 'resources', 'app', 'out', 'cli.js'),
        ];
  const cliJs = cliJsCandidates.find(p => fs.existsSync(p));

  let spawnCmd: string;
  let spawnArgs: string[];
  let spawnEnv: NodeJS.ProcessEnv;

  if (cliJs) {
    spawnCmd = exePath;
    // Linux: exePath 可能是 shell wrapper（如 /usr/bin/windsurf），不支持 ELECTRON_RUN_AS_NODE
    // 从 cli.js 路径推导出实际的 Electron 二进制文件
    if (!isWindows && !isMac) {
      const installRoot = path.resolve(path.dirname(cliJs), '..', '..', '..');
      const actualBinary = path.join(installRoot, 'windsurf');
      if (fs.existsSync(actualBinary) && actualBinary !== exePath) {
        spawnCmd = actualBinary;
      }
    }
    spawnArgs = [cliJs, '--user-data-dir', inst.userDataDir];
    spawnEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' };
  } else {
    spawnCmd = exePath;
    spawnArgs = ['--user-data-dir', inst.userDataDir];
    spawnEnv = { ...process.env };
  }

  try {
    const child = cp.spawn(spawnCmd, spawnArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: spawnEnv
    });

    // 捕获 spawn 本身的错误（如 exe 无法执行）
    const spawnError = await new Promise<Error | null>((resolve) => {
      child.on('error', (err) => resolve(err));
      // 等待 2s，如果没有 error 事件则认为启动成功
      setTimeout(() => resolve(null), 2000);
    });

    if (spawnError) {
      throw new Error(`Windsurf 进程启动失败: ${spawnError.message}\n路径: ${exePath}`);
    }

    child.unref();
    inst.lastPid = child.pid;
    log(`启动成功 PID=${child.pid}`);
  } catch (e) {
    throw new Error(`启动 Windsurf 失败: ${(e as Error).message}`);
  }

  saveStore(store);
  invalidateProcessCache();
}

export async function stopInstance(instanceId: string): Promise<void> {
  const store = loadStore();
  const inst = store.instances.find(i => i.id === instanceId);
  if (!inst) { throw new Error('实例不存在'); }

  // 找到该实例目录对应的所有 PID
  const entries = await getRunningWindsurfEntries();
  const targetPids: number[] = [];
  for (const [pid, dir] of entries) {
    if (dir && normalizePath(dir) === normalizePath(inst.userDataDir)) {
      targetPids.push(pid);
    }
  }

  if (targetPids.length > 0) {
    // 1. 先优雅关闭（让 Windsurf 自动保存）
    if (isWindows) {
      const closeScript = targetPids
        .map(p => `(Get-Process -Id ${p} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`)
        .join('; ');
      await runPowerShellAsync(closeScript, 5000);
    } else {
      // Unix: 发送 SIGTERM
      for (const p of targetPids) {
        try { process.kill(p, 'SIGTERM'); } catch { /* ignore */ }
      }
    }

    // 2. 异步等待最多 3 秒看进程是否退出
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
      const fresh = await getRunningWindsurfEntries(true);
      const stillRunning = fresh.some(([p]: [number, string | null]) => targetPids.includes(p));
      if (!stillRunning) break;
    }

    // 3. 还活着的进程才强杀
    const alive = await getRunningWindsurfEntries(true);
    const stillAlive = alive
      .filter(([p]: [number, string | null]) => targetPids.includes(p))
      .map(([p]: [number, string | null]) => p);
    for (const p of stillAlive) {
      try {
        if (isWindows) {
          cp.execSync(`taskkill /PID ${p} /T /F`, { timeout: 10000, windowsHide: true });
        } else {
          process.kill(p, 'SIGKILL');
        }
      } catch { /* ignore */ }
    }
  }

  inst.lastPid = undefined;
  saveStore(store);
  invalidateProcessCache();
}

// ─── 进程检测 ───────────────────────────────────────────

function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (isWindows) {
    return trimmed.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');
  }
  // Linux/macOS: 统一用正斜杠，不转小写（大小写敏感文件系统）
  return trimmed.replace(/\\+/g, '/').replace(/\/+$/, '');
}

/** 通过 EncodedCommand 安全运行 PowerShell（避免引号转义问题） */
function runPowerShell(script: string, timeoutMs: number): string | null {
  try {
    // PowerShell -EncodedCommand 期望 UTF-16LE base64
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const stdout = cp.execSync(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { encoding: 'utf8', timeout: timeoutMs, windowsHide: true }
    );
    return stdout;
  } catch {
    return null;
  }
}

/** 异步 PowerShell 执行（不阻塞事件循环） */
function runPowerShellAsync(script: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      cp.exec(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
        { encoding: 'utf8', timeout: timeoutMs, windowsHide: true },
        (err, stdout) => resolve(err ? null : stdout)
      );
    } catch {
      resolve(null);
    }
  });
}

/** 异步 Shell 执行（Linux/macOS 用） */
function runShellAsync(cmd: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      cp.exec(cmd, { encoding: 'utf8', timeout: timeoutMs }, (err, stdout) => resolve(err ? null : stdout));
    } catch {
      resolve(null);
    }
  });
}

// 短期缓存（避免频繁 wmic/powershell 调用）
let _processCache: { entries: Array<[number, string | null]>; ts: number } | null = null;

async function getRunningWindsurfEntries(forceFresh = false): Promise<Array<[number, string | null]>> {
  // 命中缓存
  if (!forceFresh && _processCache && Date.now() - _processCache.ts < CACHE_TTL.PROCESS) {
    return _processCache.entries;
  }

  const entries = isWindows
    ? await getRunningWindsurfEntriesWindows()
    : await getRunningWindsurfEntriesUnix();

  _processCache = { entries, ts: Date.now() };
  return entries;
}

async function getRunningWindsurfEntriesWindows(): Promise<Array<[number, string | null]>> {
  const entries: Array<[number, string | null]> = [];

  // 1. 优先使用 PowerShell（异步，不阻塞事件循环）
  try {
    const psCmd = `Get-CimInstance Win32_Process -Filter "name='Windsurf.exe'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
    const stdout = await runPowerShellAsync(psCmd, 10000);
    if (stdout && stdout.trim()) {
      const parsed = JSON.parse(stdout);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const p of list) {
        const pid = Number(p.ProcessId);
        const cmd: string = p.CommandLine || '';
        if (!pid || cmd.includes('--type=')) continue;
        const m = cmd.match(/--user-data-dir[= ]+["']?([^"']+?)["']?(?:\s+--|\s*$)/i);
        // 没有 --user-data-dir 的主进程 = 使用默认目录
        entries.push([pid, m ? m[1].trim() : getDefaultUserDataDir()]);
      }
      return entries;
    }
  } catch {
    /* fallback wmic */
  }

  // 2. 回退：wmic（旧 Windows 兼容）
  try {
    const stdout = cp.execSync(
      'wmic process where "name=\'Windsurf.exe\'" get ProcessId,CommandLine /FORMAT:LIST',
      { encoding: 'utf8', timeout: 8000, windowsHide: true }
    );
    const blocks = stdout.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      const cmdMatch = block.match(/CommandLine=(.*)/);
      const pidMatch = block.match(/ProcessId=(\d+)/);
      if (!pidMatch) continue;
      const pid = parseInt(pidMatch[1], 10);
      const cmd = cmdMatch ? cmdMatch[1] : '';
      if (cmd.includes('--type=')) continue;
      const m = cmd.match(/--user-data-dir[= ]+["']?([^"']+?)["']?(?:\s+--|\s*$)/i);
      entries.push([pid, m ? m[1].trim() : getDefaultUserDataDir()]);
    }
  } catch { /* ignore */ }

  return entries;
}

async function getRunningWindsurfEntriesUnix(): Promise<Array<[number, string | null]>> {
  const entries: Array<[number, string | null]> = [];

  // 使用 ps + grep 查找 windsurf 进程
  try {
    const stdout = await runShellAsync('ps aux', 5000);
    if (!stdout) return entries;

    const lines = stdout.split('\n');
    for (const line of lines) {
      // 匹配包含 windsurf 的进程行（排除 grep 自身和子进程 --type=）
      if (!/windsurf/i.test(line) || /grep/i.test(line) || /--type=/i.test(line)) continue;

      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[1], 10);
      if (!pid || isNaN(pid)) continue;

      // 尝试从 /proc/<pid>/cmdline 获取完整命令行（更精确）
      let cmdline = '';
      try {
        cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      } catch {
        // macOS 没有 /proc，使用 ps 行的剩余部分
        cmdline = parts.slice(10).join(' ');
      }

      const m = cmdline.match(/--user-data-dir[= ]+["']?([^"'\0]+?)["']?(?:\s+--|\s*$)/i);
      entries.push([pid, m ? m[1].trim() : getDefaultUserDataDir()]);
    }
  } catch { /* ignore */ }

  return entries;
}

/** 启停后强制失效缓存 */
function invalidateProcessCache(): void {
  _processCache = null;
}

async function getRunningInstanceDirs(): Promise<Set<string>> {
  const dirs = new Set<string>();
  for (const [, dir] of await getRunningWindsurfEntries()) {
    if (dir) { dirs.add(normalizePath(dir)); }
  }
  return dirs;
}

/** 激活指定实例的窗口（跳转） */
export async function focusInstance(instanceId: string): Promise<void> {
  const store = loadStore();
  const inst = store.instances.find(i => i.id === instanceId);
  if (!inst) throw new Error('实例不存在');

  const entries = await getRunningWindsurfEntries(true);
  const normDir = normalizePath(inst.userDataDir);
  const match = entries.find(([, dir]) => dir && normalizePath(dir) === normDir);
  if (!match) throw new Error('实例未运行');

  const pid = match[0];

  if (isWindows) {
    const script = `
      Add-Type @'
        using System;
        using System.Runtime.InteropServices;
        public class WinFocus {
          [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
          [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
          [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
        }
'@
      $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
      if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
        $h = $p.MainWindowHandle
        if ([WinFocus]::IsIconic($h)) { [WinFocus]::ShowWindow($h, 9) }
        [WinFocus]::SetForegroundWindow($h)
      }
    `;
    await runPowerShellAsync(script, 5000);
  } else {
    // Linux: 尝试 xdotool（best effort）
    // macOS: 尝试 osascript
    if (isMac) {
      await runShellAsync(`osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true'`, 3000);
    } else {
      await runShellAsync(`xdotool search --pid ${pid} --onlyvisible windowactivate 2>/dev/null || wmctrl -i -a $(wmctrl -lp | awk '$3==${pid}{print $1; exit}') 2>/dev/null`, 3000);
    }
  }
}

// ─── 绑定标记读取 ───────────────────────────────────────

export function readBindMark(userDataDir?: string): string | null {
  const dir = userDataDir || getDefaultUserDataDir();
  const bindPath = path.join(dir, BIND_FILE);
  if (!fs.existsSync(bindPath)) { return null; }
  try {
    const raw = JSON.parse(fs.readFileSync(bindPath, 'utf8'));
    return raw.bindEmail || null;
  } catch {
    return null;
  }
}

// 当前数据目录永久缓存（同一 extension host 进程内不会改变）
let _currentDirCache: string | null = null;

export function getCurrentUserDataDir(): string {
  if (_currentDirCache) return _currentDirCache;

  // 1. extension host 的 argv（部分包含启动参数）
  const args = process.argv;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user-data-dir' && args[i + 1]) {
      _currentDirCache = args[i + 1];
      return _currentDirCache;
    }
    const eqMatch = args[i].match(/^--user-data-dir=(.+)$/);
    if (eqMatch) { _currentDirCache = eqMatch[1]; return _currentDirCache; }
  }

  // 2. 回退：递归向上查找父进程（最多 5 层），找到含 --user-data-dir 的命令行
  try {
    let pid: number | undefined = process.ppid;
    for (let i = 0; i < 5 && pid; i++) {
      const info = queryProcessInfo(pid);
      if (!info) break;
      const cmdMatch = info.commandLine.match(/--user-data-dir[= ]+["']?([^"']+?)["']?(?:\s+--|\s*$)/i);
      if (cmdMatch) { _currentDirCache = cmdMatch[1].trim(); return _currentDirCache; }
      if (!info.parentPid || info.parentPid === pid) break;
      pid = info.parentPid;
    }
  } catch { /* ignore */ }

  // 3. 最后回退：默认目录
  _currentDirCache = getDefaultUserDataDir();
  return _currentDirCache;
}

/** 查询单个进程的命令行和父进程 PID（跨平台） */
function queryProcessInfo(pid: number): { commandLine: string; parentPid: number } | null {
  if (!isWindows) {
    return queryProcessInfoUnix(pid);
  }

  // PowerShell
  const psCmd = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object CommandLine,ParentProcessId | ConvertTo-Json -Compress`;
  const stdout = runPowerShell(psCmd, 5000);
  if (stdout && stdout.trim()) {
    try {
      const obj = JSON.parse(stdout);
      return {
        commandLine: obj.CommandLine || '',
        parentPid: Number(obj.ParentProcessId) || 0
      };
    } catch { /* 回退 wmic */ }
  }

  // wmic
  try {
    const wmicOut = cp.execSync(
      `wmic process where "ProcessId=${pid}" get CommandLine,ParentProcessId /FORMAT:LIST`,
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
    const cmdMatch = wmicOut.match(/CommandLine=(.*)/);
    const ppidMatch = wmicOut.match(/ParentProcessId=(\d+)/);
    return {
      commandLine: cmdMatch ? cmdMatch[1] : '',
      parentPid: ppidMatch ? parseInt(ppidMatch[1], 10) : 0
    };
  } catch { /* ignore */ }

  return null;
}

function queryProcessInfoUnix(pid: number): { commandLine: string; parentPid: number } | null {
  // Linux: 读取 /proc 文件系统
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    const statContent = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ppidMatch = statContent.match(/^\d+ \([^)]*\) \S+ (\d+)/);
    return {
      commandLine: cmdline,
      parentPid: ppidMatch ? parseInt(ppidMatch[1], 10) : 0
    };
  } catch { /* /proc 不可用（macOS） */ }

  // macOS / 通用回退: ps
  try {
    const psOut = cp.execSync(`ps -p ${pid} -o ppid=,command=`, {
      encoding: 'utf8', timeout: 3000
    });
    const trimmed = psOut.trim();
    const spaceIdx = trimmed.indexOf(' ');
    return {
      commandLine: spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1) : '',
      parentPid: parseInt(trimmed, 10) || 0
    };
  } catch { /* ignore */ }

  return null;
}

// ─── 从 Cockpit Tools 导入实例 ───────────────────────────────

function getCockpitInstancesDir(): string {
  try {
    return path.join(getAppDataDir(), '.antigravity_cockpit', 'instances', 'windsurf');
  } catch {
    // getAppDataDir 可能在极端环境下抛异常，回退到 home 目录
    return path.join(os.homedir(), '.antigravity_cockpit', 'instances', 'windsurf');
  }
}

type CockpitInstance = { id: string; dir: string; name?: string; bindEmail?: string; imported?: boolean };

// Cockpit 列表缓存（state.vscdb 几 MB 读取较慢）
let _cockpitCache: { items: CockpitInstance[]; ts: number } | null = null;

export function listCockpitInstances(forceFresh = false): CockpitInstance[] {
  // 命中缓存（imported 状态需实时计算，故只缓存 bindEmail 等较慢字段）
  let baseList: Array<Omit<CockpitInstance, 'imported'>>;
  if (!forceFresh && _cockpitCache && Date.now() - _cockpitCache.ts < CACHE_TTL.COCKPIT) {
    baseList = _cockpitCache.items;
  } else {
    baseList = scanCockpitInstances();
    _cockpitCache = { items: baseList, ts: Date.now() };
  }

  // imported 状态实时计算（防止其他实例并发导入）
  const store = loadStore();
  const importedDirs = new Set(store.instances.map(i => normalizePath(i.userDataDir)));
  return baseList.map(item => ({
    ...item,
    imported: importedDirs.has(normalizePath(item.dir))
  }));
}

function scanCockpitInstances(): Array<Omit<CockpitInstance, 'imported'>> {
  const result: Array<Omit<CockpitInstance, 'imported'>> = [];
  if (!fs.existsSync(getCockpitInstancesDir())) return result;

  const dirs = fs.readdirSync(getCockpitInstancesDir(), { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const instDir = path.join(getCockpitInstancesDir(), d.name);
    const bindEmail = readBindMarkFromStateDb(instDir);
    result.push({
      id: d.name,
      dir: instDir,
      bindEmail: bindEmail || undefined
    });
  }
  return result;
}

/** 强制刷新 Cockpit 缓存（导入后调用） */
function invalidateCockpitCache(): void {
  _cockpitCache = null;
}

export function hasUnimportedCockpitInstances(): boolean {
  return listCockpitInstances().some(ci => !ci.imported);
}

// state.vscdb bind mark 缓存（避免重复读取大文件）
const _bindMarkCache = new Map<string, { email: string | null; ts: number }>();

function readBindMarkFromStateDb(instDir: string): string | null {
  const cacheKey = instDir;
  const cached = _bindMarkCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL.BIND_MARK) {
    return cached.email;
  }

  // 1. 先尝试读取 .windsurf-pool-bind 标记
  const bindPath = path.join(instDir, BIND_FILE);
  if (fs.existsSync(bindPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(bindPath, 'utf8'));
      if (raw.bindEmail) {
        _bindMarkCache.set(cacheKey, { email: raw.bindEmail, ts: Date.now() });
        return raw.bindEmail;
      }
    } catch { /* ignore */ }
  }

  // 2. 回退：从 state.vscdb 二进制中提取 email
  const dbPath = path.join(instDir, 'User', 'globalStorage', 'state.vscdb');
  if (!fs.existsSync(dbPath)) {
    _bindMarkCache.set(cacheKey, { email: null, ts: Date.now() });
    return null;
  }

  try {
    const stats = fs.statSync(dbPath);
    // 避免读取过大的文件（超过 10MB）
    if (stats.size > 10 * 1024 * 1024) {
      console.warn('[instanceManager] state.vscdb 过大，跳过读取:', dbPath);
      _bindMarkCache.set(cacheKey, { email: null, ts: Date.now() });
      return null;
    }

    const buf = fs.readFileSync(dbPath);
    const content = buf.toString('utf8');

    // 优先匹配 windsurfAuthStatus 中的 email（JSON 形式）
    const m1 = content.match(/"windsurfAuthStatus"[^}]*?"email"\s*:\s*"([^"]+)"/);
    if (m1) {
      _bindMarkCache.set(cacheKey, { email: m1[1], ts: Date.now() });
      return m1[1];
    }

    // VS Code SecretStorage 实际存储格式：windsurf_auth-{email}
    // 收集所有匹配的 email，取出现次数最多的（最可能是当前账号）
    const authMatches = content.matchAll(/windsurf_auth-([\w._%+-]+@[\w.-]+\.\w+)/gi);
    const counter = new Map<string, number>();
    for (const m of authMatches) {
      const email = m[1].trim();
      counter.set(email, (counter.get(email) || 0) + 1);
    }
    if (counter.size > 0) {
      const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]);
      _bindMarkCache.set(cacheKey, { email: sorted[0][0], ts: Date.now() });
      return sorted[0][0];
    }

    // 兜底：找任意 email 字段
    const m3 = content.match(/"email"\s*:\s*"([\w._%+-]+@[\w.-]+\.\w+)"/);
    if (m3) {
      _bindMarkCache.set(cacheKey, { email: m3[1], ts: Date.now() });
      return m3[1];
    }

    // 最终兜底：扫描任何 email 模式
    const m4 = content.match(/[\w._%+-]+@[\w.-]+\.\w+/);
    const email = m4 ? m4[0] : null;
    _bindMarkCache.set(cacheKey, { email, ts: Date.now() });
    return email;
  } catch {
    _bindMarkCache.set(cacheKey, { email: null, ts: Date.now() });
    return null;
  }
}

export async function importCockpitInstance(cockpitId: string, newName: string, newBindEmail: string): Promise<InstanceConfig> {
  const cockpitDir = path.join(getCockpitInstancesDir(), cockpitId);
  if (!fs.existsSync(cockpitDir)) { throw new Error('Cockpit 实例不存在'); }

  const store = loadStore();
  const name = newName.trim();
  if (!name) { throw new Error('实例名称不能为空'); }
  if (store.instances.some(i => i.name === name)) { throw new Error('实例名称已存在'); }

  // 防止同一 Cockpit 目录重复导入
  const targetNorm = normalizePath(cockpitDir);
  if (store.instances.some(i => normalizePath(i.userDataDir) === targetNorm)) {
    throw new Error('该 Cockpit 实例已被导入');
  }

  const id = generateId();

  // 不复制，直接引用 Cockpit 的目录（节省空间）
  // 写入绑定标记
  const bindData = { bindEmail: newBindEmail };
  fs.writeFileSync(path.join(cockpitDir, BIND_FILE), JSON.stringify(bindData), 'utf8');

  const instance: InstanceConfig = {
    id,
    name,
    userDataDir: cockpitDir,  // 使用 Cockpit 的目录
    bindAccountId: newBindEmail,
    bindEmail: newBindEmail,
    createdAt: Date.now(),
    source: 'cockpit'
  };

  store.instances.push(instance);
  saveStore(store);
  invalidateCockpitCache();
  return instance;
}

// ─── 目录复制（排除缓存） ──────────────────────────────

/** 估算待复制的文件总数（用于进度显示） */
function countFiles(src: string): number {
  let count = 0;
  try {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (COPY_EXCLUDE.includes(entry.name)) continue;
      if (entry.isDirectory()) {
        count += countFiles(path.join(src, entry.name));
      } else if (entry.isFile()) {
        count++;
      }
    }
  } catch { /* ignore */ }
  return count;
}

interface CopyProgress {
  copied: number;
  total: number;
  onProgress?: (msg: string) => void;
  lastReportTs: number;
}

async function copyDirSelective(src: string, dst: string, progress?: CopyProgress): Promise<void> {
  ensureDir(dst);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (COPY_EXCLUDE.includes(entry.name)) { continue; }
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirSelective(srcPath, dstPath, progress);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(srcPath, dstPath);
        if (progress) {
          progress.copied++;
          // 每 200ms 报一次进度，避免刷屏
          const now = Date.now();
          if (now - progress.lastReportTs > 200 || progress.copied === progress.total) {
            progress.lastReportTs = now;
            const pct = progress.total > 0 ? Math.round((progress.copied / progress.total) * 100) : 0;
            progress.onProgress?.(`复制中… ${progress.copied}/${progress.total} (${pct}%)`);
            // 让出事件循环
            await new Promise(r => setImmediate(r));
          }
        }
      } catch { /* skip locked files */ }
    }
  }
}
