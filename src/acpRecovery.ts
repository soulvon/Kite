import { exec, execFile } from 'child_process';
import * as vscode from 'vscode';
import { detectIdeFlavor } from './ideDetector';

type DevinAgentProcess = {
  ProcessId: number;
  CreationDate: string;
};

let _repairTimer: NodeJS.Timeout | undefined;
let _reloadTimer: NodeJS.Timeout | undefined;
let _devinAcpRepairSkippedLogged = false;

function allowDevinProcessProbing(): boolean {
  if (detectIdeFlavor() !== 'devin') return true;
  return vscode.workspace
    .getConfiguration('windsurfPool.devin')
    .get<boolean>('allowProcessProbing', false);
}

/** 异步执行原生 Shell 命令（不触发安全软件拦截） */
function runCmd(cmd: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(new Error(err.message));
      else resolve(stdout.trim());
    });
  });
}

/** PowerShell 仅作 fallback（wmic 不可用时） */
function runPowerShell(script: string): Promise<string> {
  const wrappedScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
${script}
`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrappedScript],
      { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve(stdout.trim());
      }
    );
  });
}

/**
 * 修复 Windsurf 本体 ACP agent 重载后重复残留的问题。
 * 只清理重复的 `devin.exe acp --agent-type summarizer` 旧进程，不碰会话记录/.pb/state DB。
 */
export async function repairDuplicateAcpAgents(reason = 'manual'): Promise<number> {
  if (process.platform !== 'win32') return 0;
  if (!allowDevinProcessProbing()) {
    if (!_devinAcpRepairSkippedLogged) {
      _devinAcpRepairSkippedLogged = true;
      console.warn('[kite][devin] ACP 重复进程清理已跳过：该逻辑需要 wmic/PowerShell 进程探测，Devin 扩展宿主可能因此崩溃。可通过 windsurfPool.devin.allowProcessProbing 显式开启。');
    }
    return 0;
  }

  let processes: DevinAgentProcess[] = [];

  // 1. 优先用 wmic（原生命令，不触发安全软件拦截）
  try {
    const stdout = await runCmd(
      'wmic process where "name=\'devin.exe\'" get ProcessId,CommandLine,CreationDate /FORMAT:LIST'
    );
    if (stdout) {
      const blocks = stdout.split(/\r?\n\r?\n/).filter(b => b.trim());
      for (const block of blocks) {
        const pidMatch = block.match(/ProcessId=(\d+)/);
        const cmdMatch = block.match(/CommandLine=(.*)/);
        const dateMatch = block.match(/CreationDate=([\d.+\-]+)/);
        if (!pidMatch || !cmdMatch) continue;
        if (!/acp\s+--agent-type\s+summarizer/i.test(cmdMatch[1])) continue;
        const pid = parseInt(pidMatch[1], 10);
        if (!Number.isFinite(pid)) continue;
        processes.push({ ProcessId: pid, CreationDate: dateMatch ? dateMatch[1] : '0' });
      }
    }
  } catch {
    // wmic 失败，回退 PowerShell
    try {
      const psQuery = `
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -ieq 'devin.exe' -and $_.CommandLine -match 'acp\\s+--agent-type\\s+summarizer' } |
  ForEach-Object {
    [PSCustomObject]@{ ProcessId = [int]$_.ProcessId; CreationDate = $_.CreationDate.ToString('yyyyMMddHHmmss') }
  } | ConvertTo-Json -Compress
`;
      const psOut = await runPowerShell(psQuery);
      if (psOut) {
        const parsed = JSON.parse(psOut);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const p of list) {
          const pid = Number(p.ProcessId);
          if (!Number.isFinite(pid)) continue;
          processes.push({ ProcessId: pid, CreationDate: String(p.CreationDate || '0') });
        }
      }
    } catch (err) {
      console.warn(`[acpRecovery] query failed (${reason}):`, err);
      return 0;
    }
  }

  if (processes.length <= 1) return 0;

  // 按创建时间排序，保留最新的
  processes.sort((a, b) => a.CreationDate.localeCompare(b.CreationDate));
  const keep = processes[processes.length - 1];
  const stale = processes.slice(0, -1).map(p => p.ProcessId).filter(pid => pid !== keep.ProcessId);
  if (stale.length === 0) return 0;

  // 使用 taskkill 终止旧进程（原生命令，不需要 PowerShell）
  for (const pid of stale) {
    try { await runCmd(`taskkill /PID ${pid} /F`, 5000); } catch { /* ignore */ }
  }

  console.log(`[acpRecovery] cleaned stale ACP agents (${reason}); kept=${keep.ProcessId}; killed=${stale.join(',')}`);
  return stale.length;
}

export function scheduleAcpAgentRepair(reason: string, delayMs = 3500): void {
  if (process.platform !== 'win32') return;
  if (_repairTimer) clearTimeout(_repairTimer);
  _repairTimer = setTimeout(() => {
    _repairTimer = undefined;
    repairDuplicateAcpAgents(reason).catch(err => {
      console.warn(`[acpRecovery] scheduled repair failed (${reason}):`, err);
    });
  }, delayMs);
}

/**
 * 修复 Cascade 输入回弹：测活/切号后 Windsurf 的 ACP 连接偶尔会停在半失效状态。
 * 这里调用 Windsurf 官方命令重建 ACP connections，不删除会话历史。
 */
export async function reloadWindsurfAcpConnections(reason = 'manual'): Promise<boolean> {
  try {
    const commands = await vscode.commands.getCommands(true);
    // Devin 使用 devin.reloadAcpConnections，Windsurf 使用 windsurf.reloadAcpConnections
    const cmdId = commands.includes('devin.reloadAcpConnections')
      ? 'devin.reloadAcpConnections'
      : commands.includes('windsurf.reloadAcpConnections')
        ? 'windsurf.reloadAcpConnections'
        : null;
    if (!cmdId) {
      console.warn(`[acpRecovery] reload ACP command is not registered yet (${reason})`);
      return false;
    }
    await vscode.commands.executeCommand(cmdId);
    console.log(`[acpRecovery] reloaded ACP connections via ${cmdId} (${reason})`);
    return true;
  } catch (err) {
    console.warn(`[acpRecovery] reload ACP connections failed (${reason}):`, err);
    return false;
  }
}

export function scheduleAcpConnectionRecovery(reason: string, delayMs = 1500, attempts = 6): void {
  if (_reloadTimer) clearTimeout(_reloadTimer);
  _reloadTimer = setTimeout(async () => {
    _reloadTimer = undefined;
    const ok = await reloadWindsurfAcpConnections(reason);
    if (ok) {
      scheduleAcpAgentRepair(`${reason}:post-reload-cleanup`, 10_000);
      return;
    }
    if (attempts > 1) {
      scheduleAcpConnectionRecovery(`${reason}:retry`, 2500, attempts - 1);
    }
  }, delayMs);
}
