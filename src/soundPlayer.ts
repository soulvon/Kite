import * as cp from 'child_process';

/**
 * 安全执行 PowerShell：用 EncodedCommand (UTF-16LE base64) 包装脚本，
 * 避免引号转义和命令行注入。
 */
function execPowerShellEncoded(script: string, timeoutMs: number): void {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  cp.exec(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: timeoutMs, windowsHide: true },
    () => {} // ignore errors
  );
}

/**
 * 音调预设 —— 频率(Hz) + 持续时间(ms)
 */
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

/**
 * 通过 PowerShell [Console]::Beep 播放系统蜂鸣音
 * 跨平台兼容：Windows 使用 PowerShell，其他平台回退到 VS Code 终端 bell
 */
function parseCustomTone(str: string): Array<{ freq: number; dur: number }> {
  try {
    return str.split(',').map(p => {
      const [f, d] = p.trim().split(':');
      return { freq: parseInt(f) || 0, dur: parseInt(d) || 150 };
    }).filter(n => n.dur > 0);
  } catch { return []; }
}

/**
 * 播放自定义音频文件（.wav / .mp3）
 */
export function playAudioFile(filePath: string, repeat: number): void {
  if (!filePath) return;
  repeat = Math.max(1, Math.min(5, repeat));

  if (process.platform === 'win32') {
    // 转义 filePath 中的单引号（PowerShell 字符串规则：单引号内 '' 表示一个 '）
    const escapedPath = filePath.replace(/'/g, "''");
    const ext = filePath.toLowerCase();
    if (ext.endsWith('.wav')) {
      // WAV: 使用 SoundPlayer（轻量）
      const cmds: string[] = [`Add-Type -AssemblyName System.Windows.Forms`];
      for (let r = 0; r < repeat; r++) {
        cmds.push(`(New-Object Media.SoundPlayer '${escapedPath}').PlaySync()`);
        if (r < repeat - 1) cmds.push('Start-Sleep -Milliseconds 600');
      }
      execPowerShellEncoded(cmds.join(';'), 30000);
    } else {
      // MP3/其他: 使用 Windows Media Player COM
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
    // macOS: afplay
    for (let r = 0; r < repeat; r++) {
      setTimeout(() => cp.exec(`afplay "${filePath}"`, { timeout: 10000 }, () => {}), r * 3000);
    }
  } else {
    // Linux: paplay / aplay
    for (let r = 0; r < repeat; r++) {
      setTimeout(() => cp.exec(`paplay "${filePath}" 2>/dev/null || aplay "${filePath}" 2>/dev/null`, { timeout: 10000 }, () => {}), r * 3000);
    }
  }
}

export function playSystemSound(tone: string, repeat: number, customTone?: string, audioFile?: string): void {
  // 如果指定了音频文件，优先播放文件
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
    // 构建 PowerShell beep 序列；过滤非数值，避免 customTone 注入脚本
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
    execPowerShellEncoded(beepCmds.join(';'), 15000);
  } else {
    // macOS/Linux: 使用 terminal bell 字符
    for (let r = 0; r < repeat; r++) {
      setTimeout(() => process.stdout.write('\x07'), r * 800);
    }
  }
}
