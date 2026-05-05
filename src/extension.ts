import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { applyPatch, applyI18nOnly } from './sessionInjector';
import * as accountStore from './accountStore';
import { readBindMark, getCurrentUserDataDir } from './instanceManager';
import { AutoSwitcher } from './autoSwitcher';
import { checkForUpdates, autoCheckOnStartup } from './updater';

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

export function deactivate() {
  /* noop */
}
