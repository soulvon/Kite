import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SidebarProvider } from './sidebarProvider';
import { applyPatch, applyI18nOnly, ensureAcpLocalRegistryFallback, getLastInjectFailure, restoreWindsurfExtensionJs } from './sessionInjector';
import * as accountStore from './accountStore';
import { readBindMark, getCurrentUserDataDir, getCurrentInstanceName, getCurrentInstanceId, migrateAllInstancesToAuto } from './instanceManager';
import { AutoSwitcher } from './autoSwitcher';
import { initDiskCache } from './usageDiskCache';
import { StatusBarManager } from './statusBar';
import { checkForUpdates, autoCheckOnStartup } from './updater';
import { ensureEnhancement, restoreWorkbench, getInjectionStatus } from './enhancementInjector';
import { ensureBubbleRules, injectBubbleRules, removeBubbleRules, hasBubbleRules, injectScriptDisciplineRules, removeScriptDisciplineRules, removeAllEnhancementRules } from './rulesInjector';
import { fixChecksums, restoreProductJson, getChecksumStatus } from './checksumFixer';
import { startBridgeServer, stopBridgeServer } from './bridgeServer';
import { initAccountLock, acquireLock, releaseLock, startHeartbeat, stopHeartbeat } from './accountLock';
import { mergeEnhSettings, readEnhSettings, resetContinueModeOnUpgrade } from './enhSettingsStore';
import { isWindows, isMac, isWritable, safeRegisterCommand } from './utils';
import { beginElevatedBatch, flushElevatedBatch, cancelElevatedBatch, ElevationError } from './elevatedFs';
import { UsageTracker } from './usageTracker';
import { openLogPanel } from './logPanelProvider';
import { openHealthCheckPanel } from './healthCheckPanel';
import { setExtensionPath } from './cascadeProbe';
import { warmupSoundPlayer } from './soundPlayer';
import { reloadWindsurfAcpConnections, scheduleAcpAgentRepair, scheduleAcpConnectionRecovery } from './acpRecovery';
import { getIdeDisplayName, getIdeExeName, detectIdeFlavor } from './ideDetector';
import { tryRecoverLegacyAccounts, resetLegacyRecoveryAttempt, getLegacyRecoveryLog } from './legacySecretMigration';

let sidebarProvider: SidebarProvider;
let autoSwitcher: AutoSwitcher;
let statusBar: StatusBarManager;
let usageTracker: UsageTracker;
let _context: vscode.ExtensionContext;

function warnIfRenamedKiteExtensionPresent(context: vscode.ExtensionContext): void {
  // The stable extension id stays local.windsurf-pool; local.kite was a short-lived
  // rename that creates a second extension namespace and can collide with commands.
  if (context.extension.id.toLowerCase() === 'local.kite') return;
  const renamed = vscode.extensions.getExtension('local.kite');
  if (!renamed) return;
  const message = '检测到临时改名版本 local.kite 仍与当前 Kite 同时安装，会导致命令冲突和扩展崩溃。请卸载 local.kite，只保留 local.windsurf-pool（显示名仍为 Kite）。';
  const openExt = '打开扩展面板';
  const ignore = '忽略';
  vscode.window.showErrorMessage(message, openExt, ignore).then(choice => {
    if (choice === openExt) {
      vscode.commands.executeCommand('workbench.extensions.action.showExtensionsWithIds', ['local.kite']);
    }
  });
}

export function activate(context: vscode.ExtensionContext) {
  _context = context;
  setExtensionPath(context.extensionPath);

  // Detect the short-lived renamed extension id. Keeping the stable old id avoids
  // globalState/globalStorage/secrets migration during Devin startup.
  try { warnIfRenamedKiteExtensionPresent(context); } catch (e) { console.warn('[renamed-extension-check] 失败:', e); }

  // 初始化跨窗口共享的额度文件缓存（必须在 AutoSwitcher 创建前）
  initDiskCache(context);

  // 用量统计追踪器（必须在 AutoSwitcher 和 SidebarProvider 之前创建）
  usageTracker = new UsageTracker(context);
  context.subscriptions.push(usageTracker);

  // 创建后端自动切号引擎
  autoSwitcher = new AutoSwitcher(context, usageTracker);
  context.subscriptions.push(autoSwitcher);

  // 底部状态栏（独立于侧栏面板，启动即显示）
  statusBar = new StatusBarManager(context, autoSwitcher);
  context.subscriptions.push(statusBar);
  statusBar.update();

  // 跨窗口账号锁：初始化并锁定当前账号
  initAccountLock(getCurrentInstanceId(), getCurrentInstanceName());
  const curEmail = context.globalState.get<string>('lastEmail');
  if (curEmail) acquireLock(curEmail);
  startHeartbeat();

  // 创建侧栏提供器
  sidebarProvider = new SidebarProvider(context.extensionUri, context, autoSwitcher, usageTracker);
  // 侧栏手动切号成功后立即更新状态栏
  sidebarProvider.onManualSwitch = () => statusBar?.update();
  // 注册到 subscriptions，让 VSCode 在卸载时自动调用 dispose 清理 OutputChannel 和监听器
  context.subscriptions.push(sidebarProvider);

  // 注册侧栏视图
  const sidebarView = vscode.window.registerWebviewViewProvider(
    'windsurfPool.sidebar',
    sidebarProvider
  );
  context.subscriptions.push(sidebarView);

  // 注册命令
  const openSidebarCmd = safeRegisterCommand('windsurfPool.openSidebar', () => {
    vscode.commands.executeCommand('workbench.view.extension.windsurfPool');
  });
  context.subscriptions.push(openSidebarCmd);

  const applyPatchCmd = safeRegisterCommand('windsurfPool.applyPatch', async () => {
    await applyPatch(context);
  });
  context.subscriptions.push(applyPatchCmd);

  const showLogCmd = safeRegisterCommand('windsurfPool.showLog', () => {
    sidebarProvider.showLog();
  });
  context.subscriptions.push(showLogCmd);

  const openLogFileCmd = safeRegisterCommand('windsurfPool.openLogFile', () => {
    sidebarProvider.openLogFile();
  });
  context.subscriptions.push(openLogFileCmd);

  const openLogPanelCmd = safeRegisterCommand('windsurfPool.openLogPanel', (tab?: string) => {
    // 确保 bridge info 已广播，否则 syncLogs 命令无法送达 windsurf-better.js
    try { sidebarProvider?.refreshBridgeInfo?.(); } catch {}
    openLogPanel(context, usageTracker, context.extensionUri, tab, autoSwitcher);
  });
  context.subscriptions.push(openLogPanelCmd);

  // 内部命令：统计面板检测完成后通知侧边栏更新异常徽章
  const anomalyCountUpdateCmd = safeRegisterCommand('windsurfPool._anomalyCountUpdate', (count: number) => {
    sidebarProvider?.updateAnomalyCount?.(count);
  });
  context.subscriptions.push(anomalyCountUpdateCmd);

  const openHealthCheckCmd = safeRegisterCommand('windsurfPool.openHealthCheck', () => {
    openHealthCheckPanel(context, context.extensionUri, usageTracker);
  });
  context.subscriptions.push(openHealthCheckCmd);

  const recoverCascadeInputCmd = safeRegisterCommand('windsurfPool.recoverCascadeInput', async () => {
    const ok = await reloadWindsurfAcpConnections('manual-command');
    if (ok) {
      vscode.window.showInformationMessage('已刷新 Cascade 连接');
    } else {
      const ideName = getIdeDisplayName();
      vscode.window.showWarningMessage(`刷新 Cascade 连接失败，请查看 ${ideName} 日志`);
    }
  });
  context.subscriptions.push(recoverCascadeInputCmd);

  const repairMissingCredentialsCmd = safeRegisterCommand('windsurfPool.repairMissingCredentials', async () => {
    resetLegacyRecoveryAttempt();
    const accounts = await accountStore.readAccounts(context);
    const empty = accounts.filter(a => !a.apiKey);
    if (empty.length === 0) {
      vscode.window.showInformationMessage('所有账号凭据已完整，无需修复');
      return;
    }
    vscode.window.showInformationMessage(
      `正在尝试从旧版扩展恢复 ${empty.length} 个账号的凭据...`
    );
    const { accounts: recovered, recovered: anyRecovered } = await tryRecoverLegacyAccounts(context, accounts);
    const stillEmpty = recovered.filter(a => !a.apiKey);
    if (anyRecovered) {
      // 触发侧栏刷新，显示已恢复的账号
      sidebarProvider?.refresh();
      if (stillEmpty.length === 0) {
        vscode.window.showInformationMessage('凭据修复成功！所有账号已恢复。');
      } else {
        vscode.window.showWarningMessage(
          `已恢复 ${empty.length - stillEmpty.length} 个账号，仍有 ${stillEmpty.length} 个账号无法恢复，请重新导入。`
        );
      }
    } else {
      const log = getLegacyRecoveryLog().join('\n');
      vscode.window.showWarningMessage(
        '未能从旧版扩展自动恢复凭据。建议：从旧版扩展导出账号，或在 Kite 中重新导入。',
        '查看日志'
      ).then(action => {
        if (action === '查看日志') {
          const panel = vscode.window.createOutputChannel('Kite 凭据修复');
          panel.clear();
          panel.append(log || '无详细日志');
          panel.show();
        }
      });
    }
  });
  context.subscriptions.push(repairMissingCredentialsCmd);

  const refreshSidebarCmd = safeRegisterCommand('windsurfPool.refreshSidebar', () => {
    sidebarProvider.refresh();
  });
  context.subscriptions.push(refreshSidebarCmd);

  const addAccountCmd = safeRegisterCommand('windsurfPool.addAccount', () => {
    vscode.commands.executeCommand('workbench.view.extension.windsurfPool');
  });
  context.subscriptions.push(addAccountCmd);

  const switchAccountCmd = safeRegisterCommand('windsurfPool.switchAccount', async () => {
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
        console.log(`[switch][trigger] 手动切号(命令面板 switchAccount): → ${email}`);
        const { injectSession } = await import('./sessionInjector');
        const success = await injectSession(context, account);
        if (success) {
          await accountStore.setCurrentAccount(context, email);
          vscode.window.showInformationMessage('已切换至 ' + email);
          sidebarProvider.refresh();
          statusBar?.update();
        } else {
          const failure = getLastInjectFailure(email);
          vscode.window.showErrorMessage('切换失败：' + (failure?.reason || '未知原因'));
        }
      }
    }
  });
  context.subscriptions.push(switchAccountCmd);

  const switchNextCmd = safeRegisterCommand('windsurfPool.switchNextAccount', async () => {
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
    console.log(`[switch][trigger] 手动切号(命令面板 switchNext): ${currentEmail} → ${nextAccount.email}`);
    const { injectSession } = await import('./sessionInjector');
    const success = await injectSession(context, nextAccount);
    if (success) {
      await accountStore.setCurrentAccount(context, nextAccount.email);
      vscode.window.showInformationMessage('已切换至 ' + nextAccount.email);
      sidebarProvider.refresh();
      statusBar?.update();
    } else {
      const failure = getLastInjectFailure(nextAccount.email);
      vscode.window.showErrorMessage('切换失败：' + (failure?.reason || '未知原因'));
    }
  });
  context.subscriptions.push(switchNextCmd);

  const removeAccountCmd = safeRegisterCommand('windsurfPool.removeAccount', async () => {
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

  const showStatusCmd = safeRegisterCommand('windsurfPool.showStatus', async () => {
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

  const checkUpdatesCmd = safeRegisterCommand('windsurfPool.checkForUpdates', async () => {
    await checkForUpdates(false);
  });
  context.subscriptions.push(checkUpdatesCmd);

  // [Windsurf 增强] 恢复原始 workbench.html 命令（一并恢复 product.json）
  const restoreCmd = safeRegisterCommand('windsurfPool.restoreWorkbench', async () => {
    const restored = restoreWorkbench();
    const productRestored = restoreProductJson();
    const extJsRestored = restoreWindsurfExtensionJs();
    // 同步关闭开关，避免下次 activate 又自动注入；并清理增强相关规则（气泡+脚本纪律）
    await vscode.workspace.getConfiguration('windsurfPool.enhancement').update('enabled', false, vscode.ConfigurationTarget.Global);
    removeAllEnhancementRules();

    // 通知 webview 刷新状态
    try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}

    if (restored || productRestored || extJsRestored) {
      const parts: string[] = [];
      if (restored) parts.push('workbench.html');
      if (productRestored) parts.push('product.json');
      if (extJsRestored) parts.push('extension.js');
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
  const fixChecksumsCmd = safeRegisterCommand('windsurfPool.fixChecksums', async () => {
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
      console.warn('[kite] checksum missing files:', result.missing);
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

  // [Windsurf 增强] 手动注入/移除回复建议规则命令
  const injectRulesCmd = safeRegisterCommand('windsurfPool.injectBubbleRules', () => {
    const result = injectBubbleRules();
    try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}
    if (result.injected) {
      vscode.window.showInformationMessage('智能建议规则已注入到 ~/.windsurfrules');
    } else {
      vscode.window.showInformationMessage(result.error || '规则已存在，无需重复注入');
    }
  });
  context.subscriptions.push(injectRulesCmd);

  const removeRulesCmd = safeRegisterCommand('windsurfPool.removeBubbleRules', () => {
    const removed = removeBubbleRules();
    try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}
    if (removed) {
      vscode.window.showInformationMessage('已从 ~/.windsurfrules 移除智能建议规则');
    } else {
      vscode.window.showInformationMessage('未找到已注入的规则');
    }
  });
  context.subscriptions.push(removeRulesCmd);

  // [Windsurf 增强] 手动注入/移除脚本纪律规则命令
  const injectScriptCmd = safeRegisterCommand('windsurfPool.injectScriptDisciplineRules', () => {
    const result = injectScriptDisciplineRules();
    try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}
    if (result.injected) {
      vscode.window.showInformationMessage('脚本纪律规则已注入到 ~/.windsurfrules');
    } else {
      vscode.window.showInformationMessage(result.error || '规则已存在，无需重复注入');
    }
  });
  context.subscriptions.push(injectScriptCmd);

  const removeScriptCmd = safeRegisterCommand('windsurfPool.removeScriptDisciplineRules', () => {
    const removed = removeScriptDisciplineRules();
    try { sidebarProvider?.refreshEnhancementStatus?.(); } catch {}
    if (removed) {
      vscode.window.showInformationMessage('已从 ~/.windsurfrules 移除脚本纪律规则');
    } else {
      vscode.window.showInformationMessage('未找到已注入的脚本纪律规则');
    }
  });
  context.subscriptions.push(removeScriptCmd);

  // [Windsurf 增强] 重新注入命令
  const reinjectCmd = safeRegisterCommand('windsurfPool.reinjectEnhancement', async () => {
    // 增强开关被用户关闭时，ensureEnhancement 会直接 return 且无 error，友好提示而非报"未知错误"
    const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', false);
    if (!enabled) {
      const ideNameRe = getIdeDisplayName();
      const action = await vscode.window.showWarningMessage(
        `${ideNameRe} 增强已关闭，无法注入。是否立即启用？`,
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

  setTimeout(() => runDeferredStartupTasks(context), 0);
}

function runDeferredStartupTasks(context: vscode.ExtensionContext): void {
  const startupLog = (msg: string) => {
    try { sidebarProvider?.diagnosticLog?.(`[startup] ${msg}`); } catch {}
    console.log(`[kite][startup] ${msg}`);
  };
  startupLog('deferred tasks:start');
  // ── 启动后清理旧版扩展残留补丁 ──
  // 放到侧栏/命令注册之后执行，避免安装目录写入、提权或补丁兼容问题卡住首屏。
  beginElevatedBatch();
  startupLog('elevated batch:begin');

  if (detectIdeFlavor() === 'devin') {
    runDevinSafeStartup(context, startupLog);
    return;
  }

  let cleanupNeeded = false;
  try {
    startupLog('legacy cleanup:ensureEnhancement start');
    const enhResult = ensureEnhancement();
    startupLog(`legacy cleanup:ensureEnhancement result injected=${enhResult.injected} needRestart=${enhResult.needRestart} error=${enhResult.error || ''}`);
    if (enhResult.needRestart && !enhResult.injected) {
      cleanupNeeded = true;
    }
    startupLog('legacy cleanup:restoreWindsurfExtensionJs start');
    const extJsRestored = restoreWindsurfExtensionJs();
    startupLog(`legacy cleanup:restoreWindsurfExtensionJs restored=${extJsRestored}`);
    if (extJsRestored) {
      cleanupNeeded = true;
    }
    if (cleanupNeeded) {
      startupLog('legacy cleanup:cleanupNeeded=true flushing and stopping startup tasks');
      try { flushElevatedBatch(); } catch (e) {
        cancelElevatedBatch();
        startupLog(`legacy cleanup:flush failed ${e}`);
        console.warn('[kite] cleanup flush failed:', e);
      }
      vscode.window.showInformationMessage(
        `检测到旧版 ${getIdeDisplayName()} 补丁残留，已自动恢复原始文件，请立即重启。`,
        '立即重启'
      ).then(action => {
        if (action === '立即重启') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
      return;
    }
  } catch (err) {
    startupLog(`legacy cleanup failed: ${err}`);
    console.warn('[kite] legacy cleanup failed:', err);
  }

  if (readEnhSettings().acpUnlock !== false) {
    startupLog('acp local registry fallback:start');
    ensureAcpLocalRegistryFallback();
    startupLog('acp local registry fallback:done');
  }
  startupLog('schedule ACP repair/recovery');
  scheduleAcpAgentRepair('extension-activate', 10_000);
  scheduleAcpConnectionRecovery('extension-activate', 12_000);

  // v6.0.3 一次性迁移：将所有实例统一改为智能选号（旧策略余额追踪不准）
  try {
    startupLog('migrateAllInstancesToAuto:start');
    migrateAllInstancesToAuto();
    startupLog('migrateAllInstancesToAuto:done');
  } catch (e) {
    startupLog(`migrateAllInstancesToAuto failed: ${e}`);
    console.warn('[migrate] 失败:', e);
  }

  // 多实例：检测绑定标记并自动切号（后台异步，不阻塞启动）
  startupLog('autoSwitchByBindMark:schedule');
  autoSwitchByBindMark(context);

  // 预热声音播放器（Windows 上预启动 PowerShell 进程，首次播放零延迟）
  startupLog('warmupSoundPlayer:start');
  warmupSoundPlayer();
  startupLog('warmupSoundPlayer:done');

  // 静默应用汉化（不影响扩展启动）
  startupLog('applyI18nOnly:start');
  applyI18nOnly();
  startupLog('applyI18nOnly:done');

  startupLog('autoSwitcher.start:start');
  autoSwitcher?.start();
  startupLog('autoSwitcher.start:done');

  // 自动检查更新（延迟 30 秒）
  startupLog('autoCheckOnStartup:schedule');
  autoCheckOnStartup();

  // macOS/Linux: 检测安装目录是否可写，不可写则提示一次
  startupLog('checkInstallPermission:start');
  checkInstallPermission(context);
  startupLog('checkInstallPermission:done');

  // [Bridge] 启动跨 origin 桥（HTTP localhost）—— 仅当增强已启用时才启动
  const _enhEnabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', false);
  startupLog(`bridge enabled=${_enhEnabled}`);
  if (_enhEnabled) {
    startBridgeServer().then(info => {
      startupLog(`bridge ready port=${info.port}`);
      console.log(`[kite] bridge ready at 127.0.0.1:${info.port}`);
      try { sidebarProvider?.refreshBridgeInfo?.(); } catch {}
    }).catch(err => {
      startupLog(`bridge failed: ${err}`);
      console.warn('[kite] bridge server failed to start:', err);
    });
  }

  // [v7.7.11+ 升级重置] 每次版本升级都强制将 continueMode 重置为 'simple'（除长任务运行中和已禁用）
  try {
    startupLog('resetContinueModeOnUpgrade:start');
    const currentVersion: string = (context.extension?.packageJSON?.version as string) || '0.0.0';
    const m = resetContinueModeOnUpgrade(currentVersion);
    if (m.changed) {
      console.log(`[kite] reset continueMode on upgrade ${m.lastVersion ?? '(none)'} → ${currentVersion}: ${m.from} → simple`);
    } else if (m.lastVersion !== currentVersion) {
      console.log(`[kite] continueMode reset skipped (current=${m.from}) on upgrade ${m.lastVersion ?? '(none)'} → ${currentVersion}`);
    }
    startupLog(`resetContinueModeOnUpgrade:done changed=${m.changed} last=${m.lastVersion ?? ''}`);
  } catch (err) {
    startupLog(`resetContinueModeOnUpgrade failed: ${err}`);
    console.warn('[kite] resetContinueModeOnUpgrade failed:', err);
  }

  // [Windsurf 增强] 自动注入 DOM 增强脚本到 workbench.html
  try {
    startupLog('enhancement injection:start');
    const result = ensureEnhancement();
    startupLog(`enhancement injection:result injected=${result.injected} needRestart=${result.needRestart} error=${result.error || ''}`);
    if (result.needRestart) {
      if (!result.injected) {
        try { restoreWindsurfExtensionJs(); } catch {}
      }
      const ideNameEnh = getIdeDisplayName();
      vscode.window.showInformationMessage(
        `${ideNameEnh} 增强已更新，重启后生效。`,
        '立即重启'
      ).then(action => {
        if (action === '立即重启') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    }
  } catch (err) {
    startupLog(`enhancement injection failed: ${err}`);
    console.error('[kite] Enhancement injection failed:', err);
  }

  // 提交所有启动阶段的文件写操作（无需提权时零开销；需要时仅一次 UAC）
  try {
    startupLog('elevated batch:flush start');
    flushElevatedBatch();
    startupLog('elevated batch:flush done');
  } catch (err) {
    cancelElevatedBatch();
    startupLog(`elevated batch:flush failed ${err}`);
    if (err instanceof ElevationError) {
      const actions = err.userDenied
        ? ['重试（需点击"是"）', '以管理员身份运行']
        : ['以管理员身份运行'];
      vscode.window.showErrorMessage(err.message, ...actions).then(action => {
        if (action === '重试（需点击"是"）') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        } else if (action === '以管理员身份运行') {
          const psCmd = getIdeExeName().replace(/\.exe$/i, '');
          vscode.env.clipboard.writeText(`Start-Process ${psCmd} -Verb RunAs`);
          vscode.window.showInformationMessage('PowerShell 命令已复制到剪贴板，请在终端中粘贴运行。');
        }
      });
    } else {
      console.error('[kite] Elevated batch flush failed:', err);
    }
  }

  // 统一在 flushElevatedBatch 之后执行 checksum 修复：
  // 必须在 flush 之后，因为 flush 才真正把新 workbench.html 写入磁盘，
  // 此时 computeChecksum 读到的才是最新文件内容
  try {
    startupLog('autoFixChecksums:start');
    autoFixChecksums();
    startupLog('autoFixChecksums:done');
  } catch (err) {
    startupLog(`autoFixChecksums failed: ${err}`);
    console.error('[kite] Checksum fix failed:', err);
  }

  // [Windsurf 增强] 自动注入回复建议提示规则
  try {
    startupLog('ensureBubbleRules:start');
    ensureBubbleRules();
    startupLog('ensureBubbleRules:done');
  } catch (err) {
    startupLog(`ensureBubbleRules failed: ${err}`);
    console.error('[kite] Bubble rules injection failed:', err);
  }
  startupLog('deferred tasks:done');
}

function runDevinSafeStartup(
  context: vscode.ExtensionContext,
  startupLog: (msg: string) => void
): void {
  startupLog('devin safe startup:start');

  let workbenchWasInjected = false;
  try {
    const status = getInjectionStatus();
    workbenchWasInjected = status.injected;
    startupLog(`devin safe startup:workbench injected=${status.injected} patch=${status.patchVersion || ''}`);
    if (status.injected) {
      const restored = restoreWorkbench();
      startupLog(`devin safe startup:restoreWorkbench restored=${restored}`);
    }
  } catch (err) {
    startupLog(`devin safe startup:restoreWorkbench failed ${err}`);
  }

  if (workbenchWasInjected) {
    try {
      const productRestored = restoreProductJson();
      startupLog(`devin safe startup:restoreProductJson restored=${productRestored}`);
    } catch (err) {
      startupLog(`devin safe startup:restoreProductJson failed ${err}`);
    }
  } else {
    startupLog('devin safe startup:restoreProductJson skipped');
  }

  try {
    const extJsRestored = restoreWindsurfExtensionJs();
    startupLog(`devin safe startup:restoreExtensionJs restored=${extJsRestored}`);
  } catch (err) {
    startupLog(`devin safe startup:restoreExtensionJs failed ${err}`);
  }

  vscode.workspace.getConfiguration('windsurfPool.enhancement')
    .update('enabled', false, vscode.ConfigurationTarget.Global)
    .then(
      () => startupLog('devin safe startup:enhancement.enabled=false'),
      err => startupLog(`devin safe startup:disable enhancement failed ${err}`)
    );
  try {
    mergeEnhSettings({ acpUnlock: false, autoSwitchEnabled: false });
    startupLog('devin safe startup:enh settings acpUnlock=false autoSwitchEnabled=false');
  } catch (err) {
    startupLog(`devin safe startup:disable enh settings failed ${err}`);
  }

  try {
    startupLog('devin safe startup:elevated batch flush start');
    flushElevatedBatch();
    startupLog('devin safe startup:elevated batch flush done');
  } catch (err) {
    cancelElevatedBatch();
    startupLog(`devin safe startup:elevated batch flush failed ${err}`);
    if (err instanceof ElevationError) {
      vscode.window.showErrorMessage(
        'Devin 安全恢复需要写入安装目录，但当前没有权限。请以管理员身份运行 Devin 后再启动 Kite。',
        '以管理员身份运行'
      ).then(action => {
        if (action === '以管理员身份运行') {
          const psCmd = getIdeExeName().replace(/\.exe$/i, '');
          vscode.env.clipboard.writeText(`Start-Process ${psCmd} -Verb RunAs`);
          vscode.window.showInformationMessage('PowerShell 命令已复制到剪贴板，请在终端中粘贴运行。');
        }
      });
    }
  }

  try {
    startupLog('devin safe startup:migrateAllInstancesToAuto start');
    migrateAllInstancesToAuto();
    startupLog('devin safe startup:migrateAllInstancesToAuto done');
  } catch (err) {
    startupLog(`devin safe startup:migrateAllInstancesToAuto failed ${err}`);
  }

  void context.globalState.update('as.enabled', false).then(
    () => startupLog('devin safe startup:autoSwitch.enabled=false'),
    err => startupLog(`devin safe startup:disable autoSwitch failed ${err}`)
  );
  startupLog('devin safe startup:autoSwitcher.start skipped');

  try {
    startupLog('devin safe startup:checkInstallPermission start');
    checkInstallPermission(context);
    startupLog('devin safe startup:checkInstallPermission done');
  } catch (err) {
    startupLog(`devin safe startup:checkInstallPermission failed ${err}`);
  }

  startupLog('devin safe startup:done');
  if (workbenchWasInjected && !context.globalState.get<boolean>('devinSafeModeRestoreNotified')) {
    context.globalState.update('devinSafeModeRestoreNotified', true);
    vscode.window.showWarningMessage(
      'Kite 已在 Devin 中启用安全模式：已关闭自动增强注入并尝试恢复原始 Workbench。请手动重启 Devin 一次，让恢复生效。'
    );
  }
}

/**
 * 多实例启动时自动切号：如果当前 user-data-dir 存在 .windsurf-pool-bind 标记，自动注入对应账号
 */
async function autoSwitchByBindMark(context: vscode.ExtensionContext) {
  try {
    const currentDir = getCurrentUserDataDir();
    const bindEmail = readBindMark(currentDir);
    // bind mark 优先；'__auto__' 表示自动模式，回退 lastEmail（重启后恢复号池 session）
    const targetEmail = (bindEmail && bindEmail !== '__auto__')
      ? bindEmail
      : (context.globalState.get<string>('lastEmail') || '');
    console.log(`[autoSwitch][trigger] autoSwitchByBindMark: currentDir=${currentDir}, bindEmail=${bindEmail || 'none'}, targetEmail=${targetEmail || 'none'}`);
    if (!targetEmail) { return; }
    // 轮询等待账号存储就绪（最多 5 秒）
    const maxRetries = 10;
    const retryInterval = 500;
    let account: any = null;

    for (let i = 0; i < maxRetries; i++) {
      const accounts = await accountStore.readAccounts(context);
      account = accounts.find(a => a.email === targetEmail);
      if (account) break;
      await new Promise(r => setTimeout(r, retryInterval));
    }

    if (!account) {
      console.log(`[autoSwitch][trigger] autoSwitchByBindMark: 未找到账号 ${targetEmail}，跳过`);
      return;
    }

    console.log(`[autoSwitch][trigger] autoSwitchByBindMark: 执行切号 → ${targetEmail}`);
    const { injectSession } = await import('./sessionInjector');
    const success = await injectSession(context, account, { silent: true, auto: true });
    if (success) {
      console.log(`[autoSwitch][trigger] autoSwitchByBindMark: 切号成功 → ${targetEmail}`);
      await accountStore.setCurrentAccount(context, targetEmail);
    } else {
      console.warn(`[autoSwitch][trigger] autoSwitchByBindMark: 切号失败 → ${targetEmail}`);
    }
  } catch (err) {
    console.error(`[autoSwitch][trigger] autoSwitchByBindMark 异常:`, err);
  }
}

/**
 * 检测 Windsurf 安装目录是否可写（macOS/Linux 系统级安装常见问题）
 * 不可写时弹一次提示，记住用户选择
 */
function checkInstallPermission(context: vscode.ExtensionContext): void {
  // Windows: 提权已由 elevatedFs 自动处理（UAC 弹窗），无需手动提示
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
      console.warn('[kite] checksum fix:', r.error);
    } else if (r.fixed > 0) {
      console.log(`[kite] product.json checksums 已修复 ${r.fixed}/${r.total} 项`);
    }
  } catch (err) {
    console.warn('[kite] checksum fix exception:', err);
  }
}

export async function deactivate(): Promise<void> {
  try { stopHeartbeat(); } catch {}
  try { releaseLock(); } catch {}
  try { stopBridgeServer(); } catch {}
  try { const { shutdownSoundPlayer } = require('./soundPlayer'); shutdownSoundPlayer(); } catch {}

  // 记录当前账号退出日志（用于异常监控的引用计数）
  try {
    const curEmail = _context?.globalState.get<string>('lastEmail');
    if (curEmail && _context) {
      const logs: string[] = _context.globalState.get('autoSwitchLogs', []);
      const now = new Date();
      const ts = `${now.getMonth() + 1}/${now.getDate()} ${now.toTimeString().slice(0, 8)}`;
      logs.push(`[${ts}][exit] ${curEmail} → (实例关闭)`);
      if (logs.length > 200) logs.splice(0, logs.length - 200);
      await _context.globalState.update('autoSwitchLogs', logs);
    }
  } catch {}

  // 显式等待 usageTracker 写盘完成（VS Code 不会等 context.subscriptions 的 dispose Promise，
  // 必须在 deactivate 里 await，VS Code 才会等扩展卸载完成）
  try { await usageTracker?.dispose(); } catch {}
}
