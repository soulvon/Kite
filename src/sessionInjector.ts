import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StoredAccount } from './types';
import { writeFileWithElevation, copyFileWithElevation, ElevationError } from './elevatedFs';
import { scheduleAcpConnectionRecovery } from './acpRecovery';
import { checkCascadeSendReady, DEFAULT_CASCADE_CHECK_MODEL } from './usageService';
import { stripEmailEntrySuffix } from './accountStore';

/**
 * Session 注入器
 * 
 * 核心原理：
 * 1. 补丁：在 Windsurf 内置扩展 (extensions/windsurf/dist/extension.js) 中添加
 *    handleAuthTokenWithShit 方法，并注册 provideAuthTokenToAuthProviderWithShit 命令。
 *    handleAuthTokenWithShit 直接接受 {apiKey, name, apiServerUrl} 参数，跳过 registerUser。
 * 
 * 2. 注入：通过调用 windsurf.provideAuthTokenToAuthProviderWithShit 命令完成账号切换。
 */

const PATCHED_CMD = 'windsurf.provideAuthTokenToAuthProviderWithShit';
const PATCHED_METHOD = 'handleAuthTokenWithShit';
const EXPORT_CMD = 'windsurf.exportCurrentSessionWithShit';

const I18N_RULES: [string, string][] = [
  ["Surf's up, ", "欢迎回来, "],
  ["Surf's up! You are currently on a two-week Windsurf Pro trial.", "🎉 已开启 Windsurf Pro 两周试用。"],
  ["Surf's up! You have ", "🎉 你的 Windsurf Pro 试用还有 "],
  [" remaining in your Windsurf Pro trial.", " 到期。"],
  ['"1 day"', '"1 天"'],
  [" days`", " 天`"]
];

/**
 * 对 extension.js 内容应用汉化（纯函数，无副作用）
 */
function applyI18n(content: string): { content: string; changed: boolean } {
  let changed = false;
  for (const [from, to] of I18N_RULES) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      changed = true;
    }
  }
  return { content, changed };
}

/**
 * 注入导出当前 session 的命令（独立于主补丁，可补加到已补丁文件）
 * 通过定位 PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER 命令注册位置，复用相同的 AuthProvider 实例引用
 */
function injectExportCmd(content: string): { content: string; changed: boolean } {
  // 如果已有旧版导出命令（不含 getSessions 的），先删掉再重新注入
  if (content.includes(EXPORT_CMD)) {
    if (content.includes('getSessions')) return { content, changed: false }; // 已是新版
    // 移除旧版 export 注册块
    const oldStart = content.indexOf(`registerCommand("${EXPORT_CMD}"`);
    if (oldStart >= 0) {
      // 找到这个 registerCommand(...) 的配对括号
      const oldOpen = content.indexOf('(', oldStart);
      let dep = 0, oldEnd = -1;
      for (let i = oldOpen; i < content.length; i++) {
        if (content[i] === '(') dep++;
        else if (content[i] === ')') { dep--; if (dep === 0) { oldEnd = i + 1; break; } }
      }
      if (oldEnd > 0) {
        // 连同前面的逗号一起删掉
        let removeStart = oldStart;
        if (removeStart > 0 && content[removeStart - 1] === ',') removeStart--;
        content = content.substring(0, removeStart) + content.substring(oldEnd);
      }
    }
  }

  // 优先匹配已补丁的 WithShit 命令（因 Patch 2 已替换为字符串字面量）
  const cmdRe = new RegExp(
    `(\\w)\\.commands\\.registerCommand\\("${PATCHED_CMD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",async (\\w)=>\\{[^]*?await (\\w)\\.${PATCHED_METHOD}\\(\\2\\)`
  );
  let m = content.match(cmdRe);
  let nsCommands: string;
  let providerObj: string;

  if (m) {
    nsCommands = m[1];
    providerObj = m[3];
  } else {
    // 未补丁：直接定位原 handleAuthToken 命令注册
    const oriRe = /(\w)\.commands\.registerCommand\((\w)\.PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER,async (\w)=>\{[^]*?await (\w)\.handleAuthToken\(\3\)/;
    m = content.match(oriRe);
    if (!m) return { content, changed: false };
    nsCommands = m[1];
    providerObj = m[4];
  }

  // 用括号配对找到 registerCommand 调用的结尾
  const startIdx = m.index!;
  const openIdx = content.indexOf('(', startIdx);
  let depth = 0, endIdx = -1;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === '(') depth++;
    else if (content[i] === ')') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }
  if (endIdx < 0) return { content, changed: false };

  const exportRegistration =
    `,${nsCommands}.commands.registerCommand("${EXPORT_CMD}",async()=>{` +
    `try{` +
    `let ss=${providerObj}._cachedSessions;` +
    `if(!ss||!ss.length){ss=await ${providerObj}.getSessions();}` +
    `const s=ss?.[0];if(!s)return null;` +
    `const sec=${providerObj}.context.secrets;` +
    `const u=await sec.get("windsurf_auth.apiServerUrl")||await sec.get("windsurf_auth.apiServerUrl.staging")||"https://server.codeium.com";` +
    `const gs=${providerObj}.context.globalState;` +
    `const em=gs.get("lastLoginEmail")||gs.get("lastLoginEmail.staging")||"";` +
    `return{apiKey:s.accessToken,name:s.account?.label||s.account?.id||"",apiServerUrl:u,email:em};` +
    `}catch(err){return{error:String(err)};}})`;

  return { content: content.substring(0, endIdx) + exportRegistration + content.substring(endIdx), changed: true };
}

/**
 * 独立汉化：扩展激活时调用，仅替换字符串。
 * 不会触发"应用补丁"流程，可在 windsurf-zen 已 patch 的环境中独立工作。
 * 静默执行，不弹提示（除非出错）。
 */
export function applyI18nOnly(): boolean {
  try {
    const targetPath = getWindsurfExtensionJsPath();
    if (!targetPath) return false;
    const content = fs.readFileSync(targetPath, 'utf8');
    const { content: newContent, changed } = applyI18n(content);
    if (!changed) return false;
    writeFileWithElevation(targetPath, newContent, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * 注入 session 到 Windsurf
 * 
 * 通过已补丁注册的 windsurf.provideAuthTokenToAuthProviderWithShit 命令，
 * 直接传入 {apiKey, name, apiServerUrl}，跳过 registerUser 调用。
 */
// ── 全局切号计数器（用于快速判断是否在频繁切号）──
let _switchSeqNo = 0;
let _switchTimestamps: number[] = [];  // 最近 N 次切号时间
let _rejectUntil = 0;                  // 频率熔断截止时间：< 此时直接拒绝切号
let _lastInjectFailure: { email: string; reason: string; kind: 'blocked' | 'error'; ts: number } | null = null;

const RATE_LIMIT_WINDOW_MS = 60_000;   // 60s 窗口
const RATE_LIMIT_MAX = 8;              // 60s 内最多 8 次切号
const RATE_LIMIT_COOLDOWN_MS = 10_000; // 触发熔断后冷却 10s

function setInjectFailure(email: string, reason: string, kind: 'blocked' | 'error' = 'error'): void {
  _lastInjectFailure = { email, reason, kind, ts: Date.now() };
}

export function getLastInjectFailure(email?: string): { email: string; reason: string; kind: 'blocked' | 'error'; ts: number } | null {
  if (!_lastInjectFailure) return null;
  if (email && _lastInjectFailure.email !== email) return null;
  if (Date.now() - _lastInjectFailure.ts > 60_000) return null;
  return _lastInjectFailure;
}

export async function injectSession(
  context: vscode.ExtensionContext,
  account: StoredAccount,
  options?: { silent?: boolean; auto?: boolean; force?: boolean }
): Promise<boolean> {
  const silent = options?.silent ?? false;
  const isAuto = options?.auto ?? false;
  const seqNo = ++_switchSeqNo;
  const t0 = Date.now();
  _lastInjectFailure = null;
  const caller = new Error().stack?.split('\n').slice(2, 5).map(l => l.trim()).join(' <- ') || 'unknown';
  console.log(`[injectSession][#${seqNo}] ▶ 入口: email=${account.email}, silent=${silent}, auto=${isAuto}, caller=${caller}`);

  // 频率熔断仅对自动切号生效，避免 auto-switcher 死循环把所有号都"用坏"。
  // 手动切号（用户点击/命令面板/测活面板）始终允许，不参与计数也不被拒绝。
  if (isAuto) {
    if (t0 < _rejectUntil) {
      const waitS = Math.ceil((_rejectUntil - t0) / 1000);
      console.warn(`[injectSession][#${seqNo}] ✗ 自动切号频率熔断中（剩 ${waitS}s），拒绝切号 → ${account.email}`);
      setInjectFailure(account.email, `自动切号过快，${waitS}s 后再试`, 'blocked');
      return false;
    }

    _switchTimestamps.push(t0);
    _switchTimestamps = _switchTimestamps.filter(ts => t0 - ts < RATE_LIMIT_WINDOW_MS);
    if (_switchTimestamps.length > RATE_LIMIT_MAX) {
      const count = _switchTimestamps.length;
      _rejectUntil = t0 + RATE_LIMIT_COOLDOWN_MS;
      // 关键：清空时间戳，避免熔断期过后第一次调用立即又触发（因为 60s 窗口内仍有 8+ 次记录）
      _switchTimestamps = [];
      console.warn(`[injectSession][#${seqNo}] ⚠ 60s 内触发 ${count} 次自动切号 → 触发熔断，${RATE_LIMIT_COOLDOWN_MS / 1000}s 内拒绝新自动切号`);
      setInjectFailure(account.email, `自动切号过快，暂停 ${RATE_LIMIT_COOLDOWN_MS / 1000}s`, 'blocked');
      return false;
    }
  } else {
    // 手动切号：清除可能因自动切号触发的熔断，让用户点击立即生效。
    if (_rejectUntil > t0) {
      console.log(`[injectSession][#${seqNo}] 手动切号清除自动切号熔断状态`);
      _rejectUntil = 0;
      _switchTimestamps = [];
    }
  }

  // 切号前先做一次轻量限速检查：有些账号能注入、配额看起来也有，但当前模型消息额度已被服务端限流。
  // 这类账号切过去后 Windsurf 会表现为“发消息回弹”，所以直接拦截，保留原来的正常账号。
  // 用户可通过 windsurfPool.preflightSwitchCheck 关闭以提升切号速度。force=true 时（用户已确认）也跳过预检。
  const preflightEnabled = vscode.workspace.getConfiguration('windsurfPool').get<boolean>('preflightSwitchCheck', true);
  const skipPreflight = options?.force === true;
  if (preflightEnabled && !skipPreflight) {
    const ready = await checkCascadeSendReady(account, DEFAULT_CASCADE_CHECK_MODEL);
    if (!ready.ok) {
      const reason = ready.reason || '当前模型不可用';
      const hardBlock = /消息额度|频率限制|剩余 0|已用尽|Key 已失效|账号无权限|封禁|401|403/.test(reason);
      console.warn(`[injectSession][#${seqNo}] ✗ 账号发送前检查失败 → ${account.email}: ${reason}`);
      if (hardBlock) {
        setInjectFailure(account.email, reason, 'blocked');
        return false;
      }
    }
  } else {
    console.log(`[injectSession][#${seqNo}] 跳过切号预检 (preflightEnabled=${preflightEnabled}, force=${skipPreflight})`);
  }

  // 先确认补丁命令是否已注册（等待 Windsurf 内置扩展激活）
  // silent 模式（启动自动切号）等更久，因为 Windsurf 扩展可能还在加载
  const maxWait = silent ? 30 : 10;
  let cmdReady = false;
  for (let attempt = 0; attempt < maxWait; attempt++) {
    const allCmds = await vscode.commands.getCommands(true);
    if (allCmds.includes(PATCHED_CMD)) { cmdReady = true; break; }
    if (attempt === 0) {
      console.log(`[injectSession][#${seqNo}] 等待补丁命令就绪 (maxWait=${maxWait}s)...`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!cmdReady) {
    const waitMs = Date.now() - t0;
    console.warn(`[injectSession][#${seqNo}] ✗ 补丁命令未就绪 (等了 ${waitMs}ms), Windsurf 可能还没启动好`);
    // 命令不存在 — 检查文件是否已打补丁
    const targetPath = getWindsurfExtensionJsPath();
    let alreadyPatched = false;
    let cmdRegistered = false;
    if (targetPath) {
      try {
        const content = fs.readFileSync(targetPath, 'utf8');
        alreadyPatched = content.includes(PATCHED_METHOD);
        cmdRegistered = content.includes(`"${PATCHED_CMD}"`);
      } catch {}
    }

    if (alreadyPatched && !cmdRegistered) {
      // 方法已注入但命令注册缺失 — 重新应用补丁修复
      console.warn('[windsurf-pool] Patch method found but command registration missing, re-patching...');
      const ok = await applyPatch(context);
      if (!silent && ok) {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
      setInjectFailure(account.email, '补丁命令缺失，已尝试重新应用补丁', 'error');
      return false;
    }

    if (alreadyPatched) {
      // 文件完整但命令未加载
      if (silent) {
        // 启动时静默失败，不弹窗不重启
        console.warn('[windsurf-pool] Patch exists but command not loaded after ' + maxWait + 's, skipping auto-switch.');
        setInjectFailure(account.email, 'Windsurf 补丁命令尚未加载', 'error');
        return false;
      }
      // 用户手动切号 — 提示重启
      vscode.window.showWarningMessage(
        '切换失败：补丁已写入但未生效，请重启 Windsurf。',
        '立即重启'
      ).then(action => {
        if (action === '立即重启') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
      setInjectFailure(account.email, '补丁已写入但未生效，请重启 Windsurf', 'error');
      return false;
    }

    // 自动应用补丁
    if (!silent) {
      vscode.window.showInformationMessage('首次切号：正在自动应用补丁…');
    }
    const ok = await applyPatch(context);
    if (!ok) {
      setInjectFailure(account.email, '自动应用补丁失败', 'error');
      return false;
    }
    if (!silent) {
      vscode.window.showWarningMessage(
        '补丁已应用，需要重启 Windsurf 后才能切换账号。',
        '立即重启'
      ).then(action => {
        if (action === '立即重启') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    }
    setInjectFailure(account.email, '补丁已应用，需重启 Windsurf 后再切换', 'error');
    return false;
  }

  const readyMs = Date.now() - t0;
  console.log(`[injectSession][#${seqNo}] 命令就绪 (${readyMs}ms), 执行切号 → ${account.email}`);
  try {
    // 注入到 Windsurf 时使用纯邮箱（去掉号池内部的 `#oauth` 等去重后缀），
    // 否则 Windsurf 内部会显示丑陋的 `foo@bar.com#oauth`。
    const cleanEmail = stripEmailEntrySuffix(account.email);
    const result: any = await vscode.commands.executeCommand(PATCHED_CMD, {
      apiKey: account.apiKey,
      name: account.name || cleanEmail.split('@')[0],
      apiServerUrl: account.apiServerUrl,
      email: cleanEmail
    });

    const totalMs = Date.now() - t0;
    if (result && result.error) {
      console.error(`[injectSession][#${seqNo}] ✗ 命令返回错误 (${totalMs}ms):`, result.error);
      setInjectFailure(account.email, String(result.error), 'error');
      return false;
    }

    console.log(`[injectSession][#${seqNo}] ✓ 切号成功 → ${account.email} (${totalMs}ms)`);
    scheduleAcpConnectionRecovery('switch-account', 1500);
    return true;
  } catch (err) {
    const totalMs = Date.now() - t0;
    console.error(`[injectSession][#${seqNo}] ✗ 切号异常 (${totalMs}ms):`, err);
    const reason = err instanceof Error ? err.message : String(err);
    setInjectFailure(account.email, reason, 'error');
    if (!silent) {
      vscode.window.showWarningMessage('切换失败：' + reason);
    }
    return false;
  }
}

/**
 * 获取 Windsurf 内置扩展 extension.js 的路径
 */
function getWindsurfExtensionJsPath(): string | null {
  const appPath = vscode.env.appRoot;
  // 新版 Windsurf: extensions/windsurf/dist/extension.js
  const distPath = path.join(appPath, 'extensions', 'windsurf', 'dist', 'extension.js');
  if (fs.existsSync(distPath)) { return distPath; }
  // 旧版 Windsurf: extensions/windsurf/out/extension.js
  const outPath = path.join(appPath, 'extensions', 'windsurf', 'out', 'extension.js');
  if (fs.existsSync(outPath)) { return outPath; }
  return null;
}

/**
 * 应用 Windsurf 补丁
 * 
 * 在 Windsurf 内置扩展的 extension.js 中：
 * 1. 找到 handleAuthToken 方法
 * 2. 在其后面注入 handleAuthTokenWithShit 方法（跳过 registerUser，直接注入 session）
 * 3. 注册 windsurf.provideAuthTokenToAuthProviderWithShit 命令
 */
export async function applyPatch(context: vscode.ExtensionContext): Promise<boolean> {
  try {
    const targetPath = getWindsurfExtensionJsPath();
    if (!targetPath) {
      vscode.window.showWarningMessage('未找到 Windsurf 内置扩展 extension.js');
      return false;
    }

    let content = fs.readFileSync(targetPath, 'utf8');

    // 应用汉化（无副作用，幂等）
    const i18nResult = applyI18n(content);
    content = i18nResult.content;

    // 已经补丁过
    if (content.includes(PATCHED_METHOD)) {
      // 尝试补加 EXPORT_CMD（旧补丁可能没有）
      let exportAdded = false;
      if (!content.includes(EXPORT_CMD)) {
        const r = injectExportCmd(content);
        if (r.changed) { content = r.content; exportAdded = true; }
      }

      // 升级旧补丁：如果 handleAuthTokenWithShit 没有 lastLoginEmail 持久化，则内联注入
      let persistAdded = false;
      if (!content.includes('lastLoginEmail')) {
        const upgradeRe = new RegExp(
          `(${PATCHED_METHOD}\\((\\w)\\)\\{const\\{apiKey:\\w,name:\\w\\}=\\2,\\w=\\(0,\\w\\.getApiServerUrl\\)\\(\\2\\.apiServerUrl\\);)`
        );
        const um = content.match(upgradeRe);
        if (um) {
          const paramName = um[2];
          const persistBlock =
            `try{const _em=${paramName}.email||${paramName}.name||"";` +
            `this.context.globalState.update("lastLoginEmail",_em);` +
            `this.context.globalState.update("lastLoginEmail.staging",_em);` +
            `this.context.secrets.store("windsurf_auth.apiServerUrl",(0,${content.match(/\(0,(\w+)\.getApiServerUrl\)/)?.[1] || 'H'}.getApiServerUrl)(${paramName}.apiServerUrl));` +
            `}catch(_){}`;
          content = content.replace(um[0], um[0] + persistBlock);
          persistAdded = true;
        }
      }

      if (i18nResult.changed || exportAdded || persistAdded) {
        const backupPath = targetPath + '.backup_' + Date.now();
        copyFileWithElevation(targetPath, backupPath);
        writeFileWithElevation(targetPath, content, 'utf8');
        const parts: string[] = [];
        if (i18nResult.changed) parts.push('已更新欢迎语汉化');
        if (exportAdded) parts.push('已添加当前账户导出命令');
        if (persistAdded) parts.push('已添加登录状态持久化');
        vscode.window.showInformationMessage('补丁已存在，' + parts.join('、') + '（重启后生效）');
      } else {
        vscode.window.showInformationMessage('补丁已存在，无需重复应用');
      }
      return true;
    }

    // ---- Patch 1: 添加 handleAuthTokenWithShit 方法 ----
    // 匹配原始 handleAuthToken 的完整签名（适配不同变量名）
    const handleAuthRe = /async handleAuthToken\((\w)\)\{const (\w)=await\(0,(\w)\.registerUser\)\(\1\),\{apiKey:(\w),name:(\w)\}=\2,(\w)=\(0,(\w)\.getApiServerUrl\)\(\2\.apiServerUrl\)/;
    const match = content.match(handleAuthRe);

    if (!match) {
      vscode.window.showWarningMessage(
        '未找到 handleAuthToken 方法签名，可能 Windsurf 版本已更新。'
      );
      return false;
    }

    // 从匹配中提取变量名
    const [fullMatch, paramA, varE, modW, varT, varI, varN, modH] = match;

    // 安全检查：所有从被混淆代码提取出来的变量名必须是合法 JS 标识符
    // 防御：如果 Windsurf 改了混淆方式或文件被恶意污染，避免我们拼出语法错误/危险的字符串
    const VALID_ID = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
    const ids = { paramA, varE, modW, varT, varI, varN, modH };
    for (const [name, val] of Object.entries(ids)) {
      if (!VALID_ID.test(val)) {
        vscode.window.showWarningMessage(`补丁中止：提取到非法标识符 ${name}="${val.substring(0, 20)}"，Windsurf 版本可能有变化`);
        return false;
      }
    }

    const handleAuthIdx = content.indexOf(fullMatch);

    // 找到 handleAuthToken 方法体结尾 — 搜索 sessionChangeEmitter.fire 闭合
    // 注意：变量 o 是 session 对象的局部变量名，可能因混淆变化，先用宽松正则定位
    const fireRe = new RegExp(`this\\._sessionChangeEmitter\\.fire\\(\\{added:\\[(\\w)\\],removed:\\[\\],changed:\\[\\]\\}\\),\\1\\}`);
    const fireMatch = content.substring(handleAuthIdx).match(fireRe);
    if (!fireMatch) {
      vscode.window.showWarningMessage('未能定位 handleAuthToken 方法体结尾');
      return false;
    }
    const fireIdx = handleAuthIdx + fireMatch.index!;
    const insertPoint = fireIdx + fireMatch[0].length;

    // 复制原方法体的"剩余部分"：从 if(!t)throw... 到 ,o} 结束
    const bodyStart = content.indexOf(`if(!${varT})`, handleAuthIdx);
    if (bodyStart < 0 || bodyStart >= insertPoint) {
      vscode.window.showWarningMessage('未能定位 handleAuthToken 方法体起点');
      return false;
    }
    const bodyEnd = insertPoint;
    const originalBodyTail = content.substring(bodyStart, bodyEnd); // 已包含 if 检查 + 主体 + 结尾的 },o}

    // 构造 handleAuthTokenWithShit：跳过 registerUser，直接从参数 A 解构 {apiKey, name, apiServerUrl}
    // 头部仅包含解构和 url 计算，不重复 if 检查（在 originalBodyTail 中已有）
    const patchedMethodHead = `async ${PATCHED_METHOD}(${paramA}){` +
      `const{apiKey:${varT},name:${varI}}=${paramA},` +
      `${varN}=(0,${modH}.getApiServerUrl)(${paramA}.apiServerUrl);` +
      `try{const _em=${paramA}.email||${varI}||"";` +
      `this.context.globalState.update("lastLoginEmail",_em);` +
      `this.context.globalState.update("lastLoginEmail.staging",_em);` +
      `this.context.secrets.store("windsurf_auth.apiServerUrl",${varN});` +
      `}catch(_){}`;

    const fullPatchedMethod = patchedMethodHead + originalBodyTail;

    // 创建备份
    const backupPath = targetPath + '.backup_' + Date.now();
    copyFileWithElevation(targetPath, backupPath);

    // 插入 handleAuthTokenWithShit 方法
    content = content.substring(0, insertPoint) + fullPatchedMethod + content.substring(insertPoint);

    // ---- Patch 2: 注册 provideAuthTokenToAuthProviderWithShit 命令 ----
    // 原版命令注册形如: <ns>.commands.registerCommand(<ns2>.PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER,async A=>{...await <obj>.handleAuthToken(A)...})
    // 用包含 handleAuthToken(A) 的 registerCommand 调用作为定位点
    const cmdRe = /(\w)\.commands\.registerCommand\((\w)\.PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER,async (\w)=>\{[^]*?await (\w)\.handleAuthToken\(\3\)/;
    const cmdMatch = content.match(cmdRe);

    if (cmdMatch) {
      const cmdStart = cmdMatch.index!;
      // 用括号配对找到该 registerCommand 调用的结束位置
      let parenDepth = 0;
      let cmdEnd = -1;
      const openParen = content.indexOf('(', cmdStart);
      for (let i = openParen; i < content.length; i++) {
        const ch = content[i];
        if (ch === '(') { parenDepth++; }
        else if (ch === ')') {
          parenDepth--;
          if (parenDepth === 0) { cmdEnd = i + 1; break; }
        }
      }

      if (cmdEnd > 0) {
        const cmdSegment = content.substring(cmdStart, cmdEnd);
        // 替换：常量引用 PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER → 字符串字面量；handleAuthToken → handleAuthTokenWithShit
        const newCmdSegment = cmdSegment
          .replace(/\w+\.PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER/, `"${PATCHED_CMD}"`)
          .replace(/\.handleAuthToken\b/, `.${PATCHED_METHOD}`);

        // 在原命令后面插入新命令（用逗号分隔）
        content = content.substring(0, cmdEnd) + ',' + newCmdSegment + content.substring(cmdEnd);
      } else {
        vscode.window.showWarningMessage('未能定位命令注册结尾');
      }
    } else {
      vscode.window.showWarningMessage('未找到命令注册点，方法已添加但命令未注册');
    }

    // ---- Patch 3: 注册导出当前 session 的命令 ----
    const exportRes = injectExportCmd(content);
    if (exportRes.changed) content = exportRes.content;

    // 写回文件
    writeFileWithElevation(targetPath, content, 'utf8');

    vscode.window.showInformationMessage(
      `补丁已应用成功！备份保存在: ${path.basename(backupPath)}。请重启 Windsurf 使补丁生效。`
    );
    return true;
  } catch (err) {
    if (err instanceof ElevationError) {
      const actions = err.userDenied
        ? ['重试（需点击"是"）', '以管理员身份运行']
        : ['以管理员身份运行'];
      vscode.window.showErrorMessage(err.message, ...actions).then(action => {
        if (action === '重试（需点击"是"）') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        } else if (action === '以管理员身份运行') {
          vscode.env.clipboard.writeText('Start-Process windsurf -Verb RunAs');
          vscode.window.showInformationMessage('PowerShell 命令已复制到剪贴板，请在终端中粘贴运行。');
        }
      });
    } else {
      vscode.window.showErrorMessage(
        `补丁应用失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return false;
  }
}
