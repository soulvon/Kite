import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SidebarProvider } from './sidebarProvider';
import { applyPatch, applyI18nOnly } from './sessionInjector';
import * as accountStore from './accountStore';
import { readBindMark, getCurrentUserDataDir } from './instanceManager';
import { AutoSwitcher } from './autoSwitcher';
import { checkForUpdates, autoCheckOnStartup } from './updater';
import { ensureEnhancement, restoreWorkbench } from './enhancementInjector';
import { ensureBubbleRules, injectBubbleRules, removeBubbleRules, hasBubbleRules } from './rulesInjector';
import { fixChecksums, restoreProductJson, getChecksumStatus } from './checksumFixer';
import { isWindows, isMac, isWritable } from './utils';

let sidebarProvider: SidebarProvider;
let autoSwitcher: AutoSwitcher;

export function activate(context: vscode.ExtensionContext) {
  // 多实例：检测绑定标记并自动切号
  autoSwitchByBindMark(context);

  // 静默应用汉化（不影响扩展启动）
  applyI18nOnly();

  // 创建后端自动切号引擎
  autoSwitcher = new AutoSwitcher(context);
  context.subscriptions.push(autoSwitcher);
  autoSwitcher.start();

  // 自动检查更新（延迟 30 秒）
  autoCheckOnStartup();

  // macOS/Linux: 检测安装目录是否可写，不可写则提示一次
  checkInstallPermission(context);

  // 创建侧栏提供器
  sidebarProvider = new SidebarProvider(context.extensionUri, context, autoSwitcher);

  // 注册侧栏视图
  const sidebarView = vscode.window.registerWebviewViewProvider(
    'windsurfPool.sidebar',
    sidebarProvider
  );
  context.subscriptions.push(sidebarView);

  // 注册命令
  const openSidebarCmd = vscode.commands.registerCommand('windsurfPool.openSidebar', () => {
    vscode.commands.executeCommand('workbench.view.extension.windsurfPool');
  });
  context.subscriptions.push(openSidebarCmd);

  const applyPatchCmd = vscode.commands.registerCommand('windsurfPool.applyPatch', async () => {
    await applyPatch(context);
  });
  context.subscriptions.push(applyPatchCmd);

  const showLogCmd = vscode.commands.registerCommand('windsurfPool.showLog', () => {
    sidebarProvider.showLog();
  });
  context.subscriptions.push(showLogCmd);

  const openLogFileCmd = vscode.commands.registerCommand('windsurfPool.openLogFile', () => {
    sidebarProvider.openLogFile();
  });
  context.subscriptions.push(openLogFileCmd);

  const addAccountCmd = vscode.commands.registerCommand('windsurfPool.addAccount', () => {
    vscode.commands.executeCommand('workbench.view.extension.windsurfPool');
  });
  context.subscriptions.push(addAccountCmd);

  const switchAccountCmd = vscode.commands.registerCommand('windsurfPool.switchAccount', async () => {
    const accounts = await accountStore.readAccounts(context);
    if (accounts.length === 0) {
      vscode.window.showInformationMessage('暂无账号，请先登录');
      return;
    }

    const items = accounts.map((a: any) => ({
      label: a.email,
      description: a.name || a.email.split('@')[0]
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要切换的账号'
    });

    if (selected) {
      const email = selected.label;
      const account = accounts.find((a: any) => a.email === email);
      if (account) {
        const { injectSession } = await import('./sessionInjector');
        const success = await injectSession(context, account);
        if (success) {
          await accountStore.setCurrentAccount(context, email);
          vscode.window.showInformationMessage('已切换至 ' + email);
          sidebarProvider.refresh();
        } else {
          vscode.window.showErrorMessage('切换失败');
        }
      }
    }
  });
  context.subscriptions.push(switchAccountCmd);

  const switchNextCmd = vscode.commands.registerCommand('windsurfPool.switchNextAccount', async () => {
    const accounts = await accountStore.readAccounts(context);
    if (accounts.length < 2) {
      vscode.window.showInformationMessage('账号数量不足，无法切换');
      return;
    }

    const currentEmail = context.globalState.get<string>('lastEmail');
    const currentIndex = accounts.findIndex((a: any) => a.email === currentEmail);
    const nextIndex = (currentIndex + 1) % accounts.length;
    const nextAccount = accounts[nextIndex];

    // 切换到下一个账号
    const { injectSession } = await import('./sessionInjector');
    const success = await injectSession(context, nextAccount);
    if (success) {
      await accountStore.setCurrentAccount(context, nextAccount.email);
      vscode.window.showInformationMessage('已切换至 ' + nextAccount.email);
      sidebarProvider.refresh();
    }
  });
  context.subscriptions.push(switchNextCmd);

  const removeAccountCmd = vscode.commands.registerCommand('windsurfPool.removeAccount', async () => {
    const accounts = await accountStore.readAccounts(context);
    if (accounts.length === 0) {
      vscode.window.showInformationMessage('暂无账号');
      return;
    }

    const items = accounts.map((a: any) => ({
      label: a.email,
      description: '删除'
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要删除的账号'
    });

    if (selected) {
      const confirmed = await vscode.window.showWarningMessage(
        `确定删除账号 ${selected.label}?`,
        '删除',
        '取消'
      );

      if (confirmed === '删除') {
        const deleted = await accountStore.removeAccount(context, selected.label);
        if (deleted) {
          vscode.window.showInformationMessage('已删除账号');
          sidebarProvider.refresh();
        }
      }
    }
  });
  context.subscriptions.push(removeAccountCmd);

  const showStatusCmd = vscode.commands.registerCommand('windsurfPool.showStatus', async () => {
    const accounts = await accountStore.readAccounts(context);
    const currentEmail = context.globalState.get<string>('lastEmail');

    if (accounts.length === 0) {
      vscode.window.showInformationMessage('暂无账号');
      return;
    }

    const statusText = accounts
      .map((a: any) => `${a.email}${a.email === currentEmail ? ' [当前]' : ''}`)
      .join('\n');

    vscode.window.showInformationMessage(`账号列表 (${accounts.length}个):\n${statusText}`);
  });
  context.subscriptions.push(showStatusCmd);

  const checkUpdatesCmd = vscode.commands.registerCommand('windsurfPool.checkForUpdates', async () => {
    await checkForUpdates(false);
  });
  context.subscriptions.push(checkUpdatesCmd);

  // [Windsurf 增强] 自动注入 DOM 增强脚本到 workbench.html
  try {
    const result = ensureEnhancement();
    if (result.needRestart) {
      vscode.window.showInformationMessage(
        'Windsurf 增强已更新，重启后生效。',
        '立即重启'
      ).then(action => {
        if (action === '立即重启') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    }
  } catch (err) {
    console.error('[windsurf-pool] Enhancement injection failed:', err);
  }

  // 统一在 ensureEnhancement 之后执行 checksum 修复：
  // - 增强注入后：workbench.html 哈希已变，需要重算写回
  // - 未注入时：检测到无需修改则直接跳过，开销忽略不计（~几十 ms 一次性）
  // - Windsurf 升级覆盖 product.json 后：此处会再次自动修复
  try { autoFixChecksums(); } catch (err) { console.error('[windsurf-pool] Checksum fix failed:', err); }

  // [Windsurf 增强] 恢复原始 workbench.html 命令（一并恢复 product.json）
  const restoreCmd = vscode.commands.registerCommand('windsurfPool.restoreWorkbench', async () => {
    const restored = restoreWorkbench();
    const productRestored = restoreProductJson();
    // 同步关闭开关，避免下次 activate 又自动注入；并清理 bubble rules
    await vscode.workspace.getConfiguration('windsurfPool.enhancement').update('enabled', false, vscode.ConfigurationTarget.Global);
    try { removeBubbleRules(); } catch {}

    // 通知 webview 刷新状态
    try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}

    if (restored || productRestored) {
      const parts: string[] = [];
      if (restored) parts.push('workbench.html');
      if (productRestored) parts.push('product.json');
      const action = await vscode.window.showInformationMessage(`已恢复原始 ${parts.join(' + ')}，重启后生效。`, '立即重启');
      if (action === '立即重启') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    } else {
      vscode.window.showWarningMessage('未找到备份文件；已关闭增强开关并清理规则。');
    }
  });
  context.subscriptions.push(restoreCmd);

  // [Checksum 修复] 手动重算 product.json 校验值命令
  const fixChecksumsCmd = vscode.commands.registerCommand('windsurfPool.fixChecksums', async () => {
    // 单次调用即可完成检测+修复（fixed=0 时不写文件，相当于 dryRun）
    const result = fixChecksums(false);
    if (result.error) {
      vscode.window.showErrorMessage('修复失败：' + result.error);
      return;
    }
    if (result.total === 0) {
      vscode.window.showWarningMessage('未找到 product.json 或 checksums 字段');
      return;
    }

    const missingNote = result.missing.length > 0
      ? `（⚠️ ${result.missing.length} 个文件未找到，已跳过）`
      : '';
    if (result.missing.length > 0) {
      console.warn('[windsurf-pool] checksum missing files:', result.missing);
    }

    if (result.fixed === 0) {
      vscode.window.showInformationMessage(
        `product.json 校验值已是最新（${result.unchanged}/${result.total} 项匹配）${missingNote}`
      );
      return;
    }

    const action = await vscode.window.showInformationMessage(
      `已修复 ${result.fixed}/${result.total} 项校验值，重启后"已损坏"提示将不再出现。${missingNote}`,
      '立即重启'
    );
    if (action === '立即重启') {
      vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  });
  context.subscriptions.push(fixChecksumsCmd);

  // [Windsurf 增强] 自动注入回复建议提示规则
  try {
    ensureBubbleRules();
  } catch (err) {
    console.error('[windsurf-pool] Bubble rules injection failed:', err);
  }

  // [Windsurf 增强] 手动注入/移除回复建议规则命令
  const injectRulesCmd = vscode.commands.registerCommand('windsurfPool.injectBubbleRules', () => {
    const result = injectBubbleRules();
    try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}
    if (result.injected) {
      vscode.window.showInformationMessage('智能建议规则已注入到 ~/.windsurfrules');
    } else {
      vscode.window.showInformationMessage(result.error || '规则已存在，无需重复注入');
    }
  });
  context.subscriptions.push(injectRulesCmd);

  const removeRulesCmd = vscode.commands.registerCommand('windsurfPool.removeBubbleRules', () => {
    const removed = removeBubbleRules();
    try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}
    if (removed) {
      vscode.window.showInformationMessage('已从 ~/.windsurfrules 移除智能建议规则');
    } else {
      vscode.window.showInformationMessage('未找到已注入的规则');
    }
  });
  context.subscriptions.push(removeRulesCmd);

  // [Windsurf 增强] 重新注入命令
  const reinjectCmd = vscode.commands.registerCommand('windsurfPool.reinjectEnhancement', async () => {
    // 增强开关被用户关闭时，ensureEnhancement 会直接 return 且无 error，友好提示而非报"未知错误"
    const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', true);
    if (!enabled) {
      const action = await vscode.window.showWarningMessage(
        'Windsurf 增强已关闭，无法注入。是否立即启用？',
        '立即启用', '取消'
      );
      if (action === '立即启用') {
        await vscode.workspace.getConfiguration('windsurfPool.enhancement').update('enabled', true, vscode.ConfigurationTarget.Global);
      } else {
        return;
      }
    }
    try {
      const result = ensureEnhancement();
      try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}
      if (result.injected && result.needRestart) {
        vscode.window.showInformationMessage('增强脚本已注入，重启后生效。', '立即重启').then(action => {
          if (action === '立即重启') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
      } else if (result.injected) {
        vscode.window.showInformationMessage('增强脚本已是最新版本。');
      } else {
        vscode.window.showWarningMessage('注入失败：' + (result.error || '未知错误'));
      }
    } catch (err) {
      vscode.window.showErrorMessage('注入异常：' + String(err));
    }
  });
  context.subscriptions.push(reinjectCmd);
}

/**
 * 多实例启动时自动切号：如果当前 user-data-dir 存在 .windsurf-pool-bind 标记，自动注入对应账号
 */
async function autoSwitchByBindMark(context: vscode.ExtensionContext) {
  try {
    const currentDir = getCurrentUserDataDir();
    const bindEmail = readBindMark(currentDir);
    if (!bindEmail) { return; }
    // 轮询等待账号存储就绪（最多 5 秒）
    const maxRetries = 10;
    const retryInterval = 500;
    let account: any = null;

    for (let i = 0; i < maxRetries; i++) {
      const accounts = await accountStore.readAccounts(context);
      account = accounts.find(a => a.email === bindEmail);
      if (account) break;
      await new Promise(r => setTimeout(r, retryInterval));
    }

    if (!account) return;

    const { injectSession } = await import('./sessionInjector');
    const success = await injectSession(context, account, { silent: true });
    if (success) {
      await accountStore.setCurrentAccount(context, bindEmail);
    }
  } catch {
    /* ignore */
  }
}

/**
 * 检测 Windsurf 安装目录是否可写（macOS/Linux 系统级安装常见问题）
 * 不可写时弹一次提示，记住用户选择
 */
function checkInstallPermission(context: vscode.ExtensionContext): void {
  // Windows 不需要：用户级安装目录默认可写
  if (isWindows) return;

  // 已提示过则跳过
  const DISMISS_KEY = 'windsurfPool.permissionWarningDismissed';
  if (context.globalState.get<boolean>(DISMISS_KEY)) return;

  const appRoot = vscode.env.appRoot;
  // 关键文件：会话补丁需要写 extension.js，增强需要写 workbench.html
  const targets = [
    path.join(appRoot, 'extensions', 'windsurf', 'dist', 'extension.js'),
    path.join(appRoot, 'extensions', 'windsurf', 'out', 'extension.js'),
    path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
    path.join(appRoot, 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html'),
    path.join(appRoot, 'product.json'),
  ];

  // 任意一个存在且不可写即触发提示
  const blocked = targets.find(p => fs.existsSync(p) && !isWritable(p));
  if (!blocked) return;

  // 推断安装根目录（用于生成 chmod 命令）
  const installDir = isMac
    ? appRoot.replace(/\/Contents\/Resources\/app$/, '')  // .app bundle
    : appRoot.replace(/\/resources\/app$/, '');           // Linux 安装目录

  const chmodCmd = `sudo chmod -R a+w "${installDir}"`;

  vscode.window.showWarningMessage(
    `检测到 Windsurf 安装目录无写权限，无法应用切号补丁和增强注入。\n请在终端执行：\n${chmodCmd}\n执行后重启 Windsurf 即可。`,
    '复制命令',
    '已了解，不再提示'
  ).then(action => {
    if (action === '复制命令') {
      vscode.env.clipboard.writeText(chmodCmd);
      vscode.window.showInformationMessage('命令已复制到剪贴板');
    } else if (action === '已了解，不再提示') {
      context.globalState.update(DISMISS_KEY, true);
    }
  });
}

/**
 * 自动修复 product.json 中的 checksums（按配置开关控制，静默执行）
 * 在补丁/增强应用后或启动时调用，从根本消除"installation appears corrupt"提示
 */
function autoFixChecksums(): void {
  const enabled = vscode.workspace
    .getConfiguration('windsurfPool.enhancement')
    .get<boolean>('fixChecksums', true);
  if (!enabled) return;
  try {
    const r = fixChecksums(false);
    if (r.error) {
      console.warn('[windsurf-pool] checksum fix:', r.error);
    } else if (r.fixed > 0) {
      console.log(`[windsurf-pool] product.json checksums 已修复 ${r.fixed}/${r.total} 项`);
    }
  } catch (err) {
    console.warn('[windsurf-pool] checksum fix exception:', err);
  }
}

export function deactivate() {
  /* noop */
}
