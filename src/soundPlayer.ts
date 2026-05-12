import * as cp from 'child_process';

// ── PowerShell 执行层 ──

function execPowerShellEncoded(script: string, timeoutMs: number): void {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  cp.exec(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: timeoutMs, windowsHide: true },
    () => {}
  );
}

let _psProc: cp.ChildProcess | null = null;
let _psReady = false;
let _psIdleTimer: ReturnType<typeof setTimeout> | null = null;

function getPersistentPS(): cp.ChildProcess | null {
  if (_psProc && !_psProc.killed && _psProc.stdin?.writable) {
    if (_psIdleTimer) clearTimeout(_psIdleTimer);
    _psIdleTimer = setTimeout(killPersistentPS, 60_000);
    return _psProc;
  }
  try {
    _psProc = cp.spawn('powershell', ['-NoProfile', '-NoLogo', '-NonInteractive', '-Command', '-'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    _psReady = true;
    _psProc.on('exit', () => { _psProc = null; _psReady = false; });
    _psProc.on('error', () => { _psProc = null; _psReady = false; });
    _psIdleTimer = setTimeout(killPersistentPS, 60_000);
    return _psProc;
  } catch {
    return null;
  }
}

function killPersistentPS(): void {
  if (_psProc && !_psProc.killed) {
    try { _psProc.stdin?.end(); _psProc.kill(); } catch {}
  }
  _psProc = null;
  _psReady = false;
}

function sendPSCommand(cmd: string): boolean {
  const ps = getPersistentPS();
  if (!ps?.stdin?.writable) return false;
  try {
    ps.stdin.write(cmd + '\n');
    return true;
  } catch {
    return false;
  }
}

export function warmupSoundPlayer(): void {
  if (process.platform === 'win32') {
    getPersistentPS();
  }
}

export function shutdownSoundPlayer(): void {
  if (_psIdleTimer) { clearTimeout(_psIdleTimer); _psIdleTimer = null; }
  killPersistentPS();
}

// ── 音调预设 ──

const TONE_PRESETS: Record<string, Array<{ freq: number; dur: number }>> = {
  funk: [
    { freq: 587, dur: 120 },  // D5
    { freq: 784, dur: 120 },  // G5
    { freq: 880, dur: 180 },  // A5
  ],
  ding: [
    { freq: 880, dur: 250 },  // A5
  ],
  chime: [
    { freq: 659, dur: 100 },  // E5
    { freq: 784, dur: 100 },  // G5
    { freq: 988, dur: 200 },  // B5
  ],
  beep: [
    { freq: 1000, dur: 150 },
    { freq: 0, dur: 50 },
    { freq: 1000, dur: 150 },
  ],
};

function parseCustomTone(str: string): Array<{ freq: number; dur: number }> {
  try {
    return str.split(',').map(p => {
      const [f, d] = p.trim().split(':');
      return { freq: parseInt(f) || 0, dur: parseInt(d) || 150 };
    }).filter(n => n.dur > 0);
  } catch { return []; }
}

// ── 播放入口 ──

// SystemSounds 异步播放：不阻塞 PS 主线程（Beep/PlaySync 是同步阻塞，导致卡顿）
type SystemSoundName = 'Asterisk' | 'Beep' | 'Exclamation' | 'Hand' | 'Question';

// 旧 tone 名 → SystemSounds 映射（按音色感知相近度）
const TONE_TO_SYSTEM_SOUND: Record<string, SystemSoundName> = {
  funk: 'Asterisk',
  ding: 'Beep',
  chime: 'Exclamation',
  beep: 'Hand',
  // 显式新名（用户可在自定义里直接用）
  asterisk: 'Asterisk',
  exclamation: 'Exclamation',
  hand: 'Hand',
  question: 'Question',
};

function playSystemSoundsByName(name: SystemSoundName, repeat: number, intervalMs = 700): void {
  const cmd = `[System.Media.SystemSounds]::${name}.Play()`;
  const fire = (): void => {
    if (!sendPSCommand(cmd)) execPowerShellEncoded(cmd, 5000);
  };
  // 第一次立即触发，后续用 Node 调度 — PS 主线程零阻塞
  fire();
  for (let r = 1; r < repeat; r++) {
    setTimeout(fire, r * intervalMs);
  }
}

export function playAudioFile(filePath: string, repeat: number): void {
  if (!filePath) return;
  repeat = Math.max(1, Math.min(5, repeat));

  if (process.platform === 'win32') {
    const escapedPath = filePath.replace(/'/g, "''");
    const ext = filePath.toLowerCase();
    if (ext.endsWith('.wav')) {
      // 异步 Play()（不是阻塞的 PlaySync）+ Node 端调度 repeat 间隔
      // 单条命令短，PS 进程零阻塞，避免后续声音被 stdin 队列推延
      const fire = (): void => {
        const cmd = `(New-Object Media.SoundPlayer '${escapedPath}').Play()`;
        if (!sendPSCommand(cmd)) execPowerShellEncoded(cmd, 5000);
      };
      fire();
      for (let r = 1; r < repeat; r++) {
        setTimeout(fire, r * 800);
      }
    } else {
      const cmds: string[] = [
        `$p = New-Object -ComObject WMPlayer.OCX`,
        `$p.URL = '${escapedPath}'`,
        `$p.controls.play()`,
        `Start-Sleep -Milliseconds 3000`,
      ];
      for (let r = 1; r < repeat; r++) {
        cmds.push(`$p.controls.play()`, `Start-Sleep -Milliseconds 3000`);
      }
      cmds.push(`$p.close()`);
      execPowerShellEncoded(cmds.join(';'), 30000);
    }
  } else if (process.platform === 'darwin') {
    for (let r = 0; r < repeat; r++) {
      setTimeout(() => cp.exec(`afplay "${filePath}"`, { timeout: 10000 }, () => {}), r * 3000);
    }
  } else {
    for (let r = 0; r < repeat; r++) {
      setTimeout(() => cp.exec(`paplay "${filePath}" 2>/dev/null || aplay "${filePath}" 2>/dev/null`, { timeout: 10000 }, () => {}), r * 3000);
    }
  }
}

export function playSystemSound(tone: string, repeat: number, customTone?: string, audioFile?: string): void {
  if (tone === 'file' && audioFile) {
    playAudioFile(audioFile, repeat);
    return;
  }

  let notes: Array<{ freq: number; dur: number }>;
  if (tone === 'custom' && customTone) {
    notes = parseCustomTone(customTone);
    if (notes.length === 0) notes = TONE_PRESETS.funk;
  } else {
    notes = TONE_PRESETS[tone] || TONE_PRESETS.funk;
  }
  repeat = Math.max(1, Math.min(5, repeat));

  if (process.platform === 'win32') {
    // 预设音调（funk/ding/chime/beep + 显式 SystemSounds 名）→ SystemSounds 异步播放
    // [Console]::Beep 是同步阻塞，会让 PS 主线程卡住整个音符时长，听感上是"卡顿/延迟"
    // SystemSounds.Play 是 fire-and-forget，由 Windows 音频子系统异步调度，零卡顿
    const sysSound = TONE_TO_SYSTEM_SOUND[tone];
    if (sysSound) {
      playSystemSoundsByName(sysSound, repeat);
      return;
    }

    // 仅 custom 自定义频率走 [Console]::Beep（保留用户对频率/时长的精细控制）
    const beepCmds: string[] = [];
    for (let r = 0; r < repeat; r++) {
      for (const n of notes) {
        const freq = Math.max(0, Math.min(20000, Math.floor(Number(n.freq) || 0)));
        const dur = Math.max(1, Math.min(5000, Math.floor(Number(n.dur) || 0)));
        if (freq > 0) {
          beepCmds.push(`[Console]::Beep(${freq},${dur})`);
        } else {
          beepCmds.push(`Start-Sleep -Milliseconds ${dur}`);
        }
      }
      if (r < repeat - 1) {
        beepCmds.push('Start-Sleep -Milliseconds 600');
      }
    }
    if (!sendPSCommand(beepCmds.join(';'))) {
      execPowerShellEncoded(beepCmds.join(';'), 15000);
    }
  } else {
    for (let r = 0; r < repeat; r++) {
      setTimeout(() => process.stdout.write('\x07'), r * 800);
    }
  }
}
