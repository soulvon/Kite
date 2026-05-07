import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WebviewMessage, BackendMessage } from './types';
import * as accountStore from './accountStore';
import { login, loginByAuth1Token } from './loginService';
import { fetchUsage } from './usageService';
import { injectSession } from './sessionInjector';
import * as instanceManager from './instanceManager';
import { AutoSwitcher } from './autoSwitcher';
import { getSignalBridgeScript, handlePoolSignal, PoolSignal } from './signalBridge';
import { getInjectionStatus, ensureEnhancement } from './enhancementInjector';
import { readEnhSettings, writeEnhSettings, mergeEnhSettings } from './enhSettingsStore';
import { hasBubbleRules } from './rulesInjector';
import { playSystemSound } from './soundPlayer';

/**
 * 侧栏 Webview 提供器
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _disposables: vscode.Disposable[] = [];
  private _output = vscode.window.createOutputChannel('Windsurf 号池');
  private _startTs = Date.now();
  private _logFilePath: string;
  private _autoSwitcher: AutoSwitcher;

  constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext, autoSwitcher: AutoSwitcher) {
    // 日志文件：globalStorage/windsurf-pool.log（保留最近 500KB）
    try {
      fs.mkdirSync(this._context.globalStorageUri.fsPath, { recursive: true });
    } catch {}
    this._logFilePath = path.join(this._context.globalStorageUri.fsPath, 'windsurf-pool.log');
    // 每次启动在文件头写分隔符
    try {
      const header = `\n\n==================== ${new Date().toISOString()} ====================\n`;
      fs.appendFileSync(this._logFilePath, header, 'utf8');
      // 文件过大则截断（只保留后 200KB）
      const stat = fs.statSync(this._logFilePath);
      if (stat.size > 500 * 1024) {
        const buf = fs.readFileSync(this._logFilePath);
        fs.writeFileSync(this._logFilePath, buf.slice(-200 * 1024));
      }
    } catch {}

    // 绑定后端自动切号引擎
    this._autoSwitcher = autoSwitcher;
    this._autoSwitcher.onUsageUpdate = (email, snapshot, error) => {
      this.postMessage({ type: 'usage', email, snapshot, error } as any);
    };
    this._autoSwitcher.onSwitchEvent = (log, status, statusType) => {
      this.postMessage({ type: 'autoSwitchEvent', log, status, statusType } as any);
    };
    this._autoSwitcher.onRefreshUI = () => {
      this.refresh();
    };
  }

  private log(msg: string) {
    const elapsed = ((Date.now() - this._startTs) / 1000).toFixed(2);
    const ts = new Date().toISOString().substring(11, 23);
    const line = `[${ts}] [+${elapsed}s] ${msg}`;
    this._output.appendLine(line);
    try { fs.appendFileSync(this._logFilePath, line + '\n', 'utf8'); } catch {}
  }

  /** 显示日志面板 */
  public showLog() {
    this._output.appendLine(`日志文件: ${this._logFilePath}`);
    this._output.show(true);
  }

  /** 主动通知 webview 刷新 Windsurf 增强状态（供外部命令在修改文件/配置后调用） */
  public refreshEnhancementStatus(): void {
    this._pushEnhancementStatus();
  }

  /** 打开日志文件 */
  public async openLogFile() {
    try {
      const doc = await vscode.workspace.openTextDocument(this._logFilePath);
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      this.showAlert('错误', '打开日志失败：' + err, 'error');
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // 初始加载：先用 poolLastEmail 快速渲染，5s 后做 auth 检测
    setTimeout(() => this.refresh(true), 300);
    setTimeout(() => {
      this.refresh();
      this._pushAutoSwitchSettings();
    }, 5000);

    // 推送后端缓存和设置给 webview
    setTimeout(() => {
      this._pushCachedUsage();
      this._pushAutoSwitchSettings();
      this._pushEnhancementStatus();
    }, 600);

    // 监听 auth session 变化（Windsurf 登录/登出时触发）
    try {
      const sub = vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === 'windsurf_auth') this.refresh();
      });
      this._disposables.push(sub);
    } catch { /* ignore */ }

    // 监听共享账号文件变化（多实例同步）
    try {
      let debounceTimer: NodeJS.Timeout | undefined;
      const unwatch = accountStore.watchAccountsFile(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { this.refresh(); }, 300);
      });
      this._disposables.push({ dispose: unwatch });
    } catch { /* ignore */ }

    // 监听 instances.json 变化（跨实例实时同步邮箱/状态）
    try {
      let instDebounce: NodeJS.Timeout | undefined;
      const unwatchInst = instanceManager.watchInstancesFile(() => {
        if (instDebounce) clearTimeout(instDebounce);
        instDebounce = setTimeout(async () => {
          try {
            const instances = await instanceManager.listInstances();
            this.postMessage({ type: 'instanceListResult', instances });
          } catch {}
        }, 500);
      });
      this._disposables.push({ dispose: unwatchInst });
    } catch { /* ignore */ }

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
        this._pushAutoSwitchSettings();
        this._pushEnhancementStatus();
      }
    });

    // 监听 webview 消息
    webviewView.webview.onDidReceiveMessage(async (message: any) => {
      await this.handleMessage(message);
    });
  }

  /** 推送后端缓存的所有 usage 数据给 webview */
  private _pushCachedUsage(): void {
    for (const [email, entry] of this._autoSwitcher.getAllCached()) {
      this.postMessage({ type: 'usage', email, snapshot: entry.snapshot, error: entry.error } as any);
    }
  }

  /** 推送 Windsurf 增强状态给 webview */
  private _pushEnhancementStatus(): void {
    try {
      const status = getInjectionStatus();
      const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', true);
      const autoRecovery = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('autoRecovery', true);
      const ext = vscode.extensions.getExtension('local.windsurf-pool');
      const extVersion = ext?.packageJSON?.version || '0.0.0';
      const patchVersion = status.patchVersion || '0.0.0';
      const bubbleRulesInjected = hasBubbleRules();
      const signalBridgeActive = status.injected;
      this.postMessage({
        type: 'enhancementStatus',
        injected: status.injected,
        patchVersion,
        extensionVersion: extVersion,
        enabled,
        autoRecovery,
        bubbleRulesInjected,
        signalBridgeActive,
      } as any);
    } catch {}
  }

  /** 推送自动切号设置给 webview */
  private _pushAutoSwitchSettings(): void {
    const s = this._autoSwitcher.settings;
    this.postMessage({ type: 'autoSwitchSettingsSync', ...s } as any);
  }

  /**
   * 处理 webview 消息
   */
  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'enhLoad': {
        // webview 启动时拉取磁盘上的真相源
        const settings = readEnhSettings();
        this.postMessage({ type: 'enhLoaded', settings } as any);
        return;
      }
      case 'enhSave': {
        // webview 改了设置 → 写盘 → 重写 workbench.html 嵌入新值 → 提示重启
        const patch = (message as any).settings || {};
        const merged = mergeEnhSettings(patch);
        // 立即重新注入 workbench.html，使下次 reload 即可生效
        try {
          ensureEnhancement();
        } catch (err) {
          console.warn('[windsurf-pool] re-inject after enhSave failed:', err);
        }
        // 回传保存结果（webview 可据此显示"已保存，重启生效"banner）
        this.postMessage({ type: 'enhSaved', settings: merged } as any);
        return;
      }
      case 'loginSave': {
        const { email, password, batch, authMethod, tag } = message;
        if (!email || !password) {
          if (!batch) {
            this.showAlert('提示', '请输入邮箱和密码', 'warn');
          }
          return;
        }

        const doLogin = async () => {
          const result = await login(email, password, authMethod || 'auto');
          if (result.ok && result.value) {
            if (tag) result.value.tag = tag;
            await accountStore.upsertAccount(this._context, result.value);
            if (batch) {
              this.postMessage({ type: 'batchResult', ok: true, email });
              this.refresh();
            } else {
              this.showAlert('登录成功', '已登录并保存：' + email, 'info');
              this.refresh();
            }
          } else {
            if (!batch) {
              this.showAlert('登录失败', (result.error || '登录失败') + '：' + email, 'error');
            } else {
              this.postMessage({ type: 'batchResult', ok: false, email, error: result.error });
            }
          }
        };

        if (batch) {
          await doLogin();
        } else {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '登录中… ' + email, cancellable: false },
            doLogin
          );
        }
        break;
      }

      case 'switch': {
        const { email } = message;
        if (!email) return;

        const accounts = await accountStore.readAccounts(this._context);
        const account = accounts.find(a => a.email === email);
        if (!account) {
          this.showAlert('提示', '账号不存在', 'warn');
          return;
        }

        const success = await injectSession(this._context, account);
        if (success) {
          await accountStore.setCurrentAccount(this._context, email);
          // 无感切号：成功不弹任何提示，UI 高亮自动转移即为反馈
          this.refresh();
        } else {
          this.showAlert('切换失败', '切换失败：' + email, 'error');
        }
        break;
      }

      case 'delete': {
        const { email } = message;
        if (!email) return;

        const deleted = await accountStore.removeAccount(this._context, email);
        if (deleted) {
          this.refresh();
        }
        break;
      }

      case 'batchDelete': {
        const { emails } = message;
        if (!emails || !emails.length) return;
        const removed = await accountStore.batchRemove(this._context, emails);
        if (removed > 0) {
          this.refresh();
        }
        break;
      }

      case 'updateTag': {
        const { email, tag } = message;
        if (!email) return;
        await accountStore.updateTag(this._context, email, tag || '');
        this.refresh(true);
        break;
      }

      case 'toggleDisabled': {
        const { email } = message;
        if (!email) return;
        await accountStore.toggleDisabled(this._context, email);
        this.refresh(true);
        break;
      }

      case 'batchEnable': {
        const { emails } = message;
        if (!emails || !emails.length) return;
        await accountStore.batchSetDisabled(this._context, emails, false);
        this.refresh();
        break;
      }

      case 'batchDisable': {
        const { emails } = message;
        if (!emails || !emails.length) return;
        await accountStore.batchSetDisabled(this._context, emails, true);
        this.refresh();
        break;
      }

      case 'batchTag': {
        const { emails, tag } = message;
        if (!emails || !emails.length) return;
        await accountStore.batchUpdateTag(this._context, emails, tag || '');
        this.refresh();
        break;
      }

      case 'fetchUsageFor': {
        const { email } = message;
        if (!email) return;

        // 优先返回后端缓存（60s 内有效）
        const cached = this._autoSwitcher.getCached(email);
        if (cached && Date.now() - cached.ts < 60_000) {
          this.postMessage({ type: 'usage', email, snapshot: cached.snapshot, error: cached.error });
          break;
        }

        // 缓存过期：后端刷新（结果通过 onUsageUpdate 回调推送）
        await this._autoSwitcher.refreshSingle(email, true);
        break;
      }

      case 'refreshAllUsage': {
        this._autoSwitcher.refreshAll(true);
        break;
      }

      case 'autoSwitchSettings': {
        const m = message as any;
        await this._autoSwitcher.updateSettings({
          enabled: m.enabled,
          threshold: m.threshold,
          checkSec: m.checkSec,
          cooldownSec: m.cooldownSec,
          refreshMin: m.refreshMin,
          scoreMode: m.scoreMode,
          switchStrategy: m.switchStrategy,
          minQuota: m.minQuota,
          preferUsedThreshold: m.preferUsedThreshold,
          poolScope: m.poolScope,
          poolTag: m.poolTag,
        });
        this._pushAutoSwitchSettings();
        break;
      }

      case 'batchLogin': {
        const { email, password, authMethod } = message;
        if (!email || !password) return;

        const result = await login(email, password, authMethod || 'auto');
        if (result.ok && result.value) {
          await accountStore.upsertAccount(this._context, result.value);
          this.postMessage({
            type: 'batchResult',
            ok: true,
            email
          });
        } else {
          this.postMessage({
            type: 'batchResult',
            ok: false,
            email,
            error: result.error
          });
        }
        break;
      }

      case 'batchTokenImport': {
        const token = message.token;
        if (!token) return;
        const tokenResult = await loginByAuth1Token(token);
        if (tokenResult.ok && tokenResult.value) {
          if (message.tag) tokenResult.value.tag = message.tag;
          await accountStore.upsertAccount(this._context, tokenResult.value);
          this.postMessage({ type: 'batchResult', ok: true, email: tokenResult.value.email });
          this.refresh();
        } else {
          this.postMessage({ type: 'batchResult', ok: false, email: token.substring(0, 20) + '...', error: tokenResult.error });
        }
        break;
      }

      case 'runCommand': {
        const { command } = message;
        if (command) {
          vscode.commands.executeCommand(command);
        }
        break;
      }

      case 'openExternal': {
        const { url } = message;
        if (url) {
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
        break;
      }

      case 'addCurrent': {
        await this.handleAddCurrent();
        break;
      }

      case 'alertResponse': {
        const cb = this._alertCallbacks.get(message.id!);
        if (cb) {
          this._alertCallbacks.delete(message.id!);
          cb(message.action ?? null);
        }
        break;
      }

      case 'getEnhancementStatus': {
        this._pushEnhancementStatus();
        break;
      }

      case 'toggleEnhancement': {
        const current = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', true);
        const next = !current;
        await vscode.workspace.getConfiguration('windsurfPool.enhancement').update('enabled', next, vscode.ConfigurationTarget.Global);

        // 真正启用/关闭：操作文件而非仅改配置
        const { ensureEnhancement, restoreWorkbench } = await import('./enhancementInjector');
        const { injectBubbleRules, removeBubbleRules } = await import('./rulesInjector');
        let fileChanged = false;
        try {
          if (next) {
            // 启用：注入 workbench.html + 注入 bubble rules
            const r = ensureEnhancement();
            if (r.injected && r.needRestart) fileChanged = true;
            injectBubbleRules();
          } else {
            // 关闭：恢复 workbench.html + 移除 bubble rules
            if (restoreWorkbench()) fileChanged = true;
            removeBubbleRules();
          }
        } catch (err) {
          console.error('[windsurf-pool] toggleEnhancement file op failed:', err);
        }

        this._pushEnhancementStatus();
        const label = next ? '已启用' : '已关闭';
        const msg = fileChanged
          ? `Windsurf 增强${label}，需要重载窗口才能生效。`
          : `Windsurf 增强${label}。`;
        const action = await vscode.window.showInformationMessage(msg, '立即重载');
        if (action === '立即重载') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        break;
      }

      // ── 多实例管理 ──
      case 'instanceList': {
        try {
          const instances = await instanceManager.listInstances();
          // 将当前窗口的活跃账号同步到 instances.json（供其他窗口读取）
          const currentEmail = this._context.globalState.get<string>('lastEmail') || '';
          if (currentEmail) {
            const myInst = instances.find(i => i.current);
            if (myInst && myInst.bindEmail !== currentEmail) {
              myInst.bindEmail = currentEmail;
              instanceManager.syncCurrentInstanceEmail(currentEmail);
            }
          }
          const hasUnimported = instanceManager.hasUnimportedCockpitInstances();
          this.postMessage({ type: 'instanceListResult', instances, hasUnimported });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceCreate': {
        const { instanceName, email } = message;
        if (!instanceName || !email) {
          this.postMessage({ type: 'instanceError', error: '名称和绑定账号不能为空' });
          return;
        }
        try {
          this.postMessage({ type: 'instanceProgress', message: '正在复制 Windsurf 数据目录…' });
          await instanceManager.createInstance({
            name: instanceName,
            bindEmail: email,
            onProgress: (msg) => {
              this.postMessage({ type: 'instanceProgress', message: msg });
            }
          });
          this.postMessage({ type: 'instanceProgress', message: '实例创建完成', done: true });
          // 刷新列表
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceProgress', message: String(err), done: true, error: true });
        }
        break;
      }

      case 'instanceDelete': {
        const { instanceId } = message;
        if (!instanceId) return;
        try {
          instanceManager.deleteInstance(instanceId);
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceStart': {
        const { instanceId } = message;
        if (!instanceId) return;
        try {
          this.postMessage({ type: 'instanceProgress', message: '正在启动实例…' });
          await instanceManager.startInstance(instanceId);
          this.postMessage({ type: 'instanceProgress', message: '实例已启动 ✓', done: true });
          // 稍等后刷新状态（让进程完全启动）
          setTimeout(async () => {
            try {
              const instances = await instanceManager.listInstances();
              this.postMessage({ type: 'instanceListResult', instances });
            } catch {}
          }, 3000);
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceFocus': {
        const { instanceId } = message;
        if (!instanceId) return;
        try {
          await instanceManager.focusInstance(instanceId);
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceStop': {
        const { instanceId } = message;
        if (!instanceId) return;
        try {
          this.postMessage({ type: 'instanceProgress', message: '正在优雅关闭实例…' });
          await instanceManager.stopInstance(instanceId);
          this.postMessage({ type: 'instanceProgress', message: '实例已停止', done: true });
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      case 'instanceUpdate': {
        const { instanceId, instanceName, email, assignedTag } = message;
        if (!instanceId) return;
        try {
          if (instanceName) {
            instanceManager.updateInstanceName(instanceId, instanceName);
          }
          if (email) {
            instanceManager.updateInstanceBind(instanceId, email);
          }
          if (assignedTag !== undefined) {
            instanceManager.updateInstanceTag(instanceId, assignedTag || undefined);
          }
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      // ── Cockpit Tools 导入 ──
      case 'cockpitList': {
        try {
          const instances = instanceManager.listCockpitInstances();
          this.postMessage({ type: 'cockpitListResult', instances });
        } catch (err) {
          this.postMessage({ type: 'instanceError', error: String(err) });
        }
        break;
      }

      // ── 完成提醒：浏览音频文件 ──
      case 'browseAudioFile': {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { '音频文件': ['wav', 'mp3', 'ogg', 'flac'] },
          title: '选择提醒音频文件',
        });
        if (uris && uris.length > 0) {
          this.postMessage({ type: 'audioFileSelected', path: uris[0].fsPath } as any);
        }
        break;
      }

      // ── 完成提醒：系统声音播放 ──
      case 'playNotifySound': {
        const d = (message as any).data || {};
        const tone = d.tone || 'funk';
        const repeat = d.repeat || 2;
        if (d.sound !== false) {
          playSystemSound(tone, repeat, d.customTone, d.audioFile);
        }
        if (d.desktop) {
          vscode.window.showInformationMessage(d.title || 'Cascade 完成', d.body || 'AI 回复已完成');
        }
        break;
      }

      // ── Windsurf 增强：信号桥接 ──
      case 'poolSignal': {
        const signal = (message as any).data as PoolSignal;
        if (!signal || !signal.ts) break;
        await handlePoolSignal(signal, this._autoSwitcher, (result) => {
          this.postMessage({ type: 'poolResult', data: result } as any);
        });
        break;
      }

      case 'cockpitImport': {
        const { cockpitId, instanceName, email } = message;
        if (!cockpitId || !instanceName || !email) {
          this.postMessage({ type: 'instanceError', error: '参数不完整' });
          return;
        }
        try {
          this.postMessage({ type: 'instanceProgress', message: '正在导入 Cockpit 实例…' });
          await instanceManager.importCockpitInstance(cockpitId, instanceName, email);
          this.postMessage({ type: 'instanceProgress', message: '导入完成', done: true });
          const instances = await instanceManager.listInstances();
          this.postMessage({ type: 'instanceListResult', instances });
          // 刷新 Cockpit 列表中的 imported 状态
          const cockpitInstances = instanceManager.listCockpitInstances();
          this.postMessage({ type: 'cockpitListResult', instances: cockpitInstances });
        } catch (err) {
          this.postMessage({ type: 'instanceProgress', message: String(err), done: true, error: true });
        }
        break;
      }
    }
  }

  /**
   * 从 Windsurf 当前已登录账户导入到号池
   * 复用 detectCurrentWindsurfAccount 获取 session 信息
   */
  private async handleAddCurrent(): Promise<void> {
    // 最多等待 15 秒，等 Windsurf 内置扩展就绪
    let apiKey = '';
    let accountLabel = '';
    let detectedApiServerUrl = '';
    for (let i = 0; i < 15; i++) {
      const result = await this.detectCurrentWindsurfAccount();
      apiKey = result.token;
      accountLabel = result.label;
      detectedApiServerUrl = result.apiServerUrl || '';
      if (apiKey) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!apiKey) {
      this.showConfirm('提示', 'Windsurf 账户信息尚未加载完成，请稍后再试。', ['重试', '取消'], 'warn').then(action => {
        if (action === '重试') { this.handleAddCurrent(); }
      });
      return;
    }

    const email = accountLabel.includes('@') ? accountLabel : (accountLabel || 'user') + '@windsurf.local';

    // 检查是否重复
    const existing = await accountStore.readAccounts(this._context);
    const dup = existing.find(a => a.email === email);
    if (dup) {
      const action = await this.showConfirm('确认', `账号 ${email} 已在号池中，是否更新其 Session？`, ['更新', '取消'], 'warn');
      if (action !== '更新') return;
    }

    // 优先使用补丁命令返回的真实 apiServerUrl，回退到默认 codeium
    const account: any = {
      email,
      apiKey,
      apiServerUrl: detectedApiServerUrl || 'https://server.codeium.com',
      name: accountLabel || ''
    };

    await accountStore.upsertAccount(this._context, account);
    // 加入后设为当前账户（因为这就是 Windsurf 实际登录的号）
    await accountStore.setCurrentAccount(this._context, email);
    this.showAlert('添加成功', (dup ? '已更新并设为当前：' : '已添加并设为当前：') + email, 'info');
    this.refresh();
  }

  /**
   * 发送消息到 webview
   */
  private postMessage(message: BackendMessage): void {
    this._view?.webview.postMessage(message);
  }

  // 通用 webview 弹窗（无需回调）
  private showAlert(title: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this._view?.webview.postMessage({ type: 'showAlert', title, message, level });
  }

  // 通用 webview 确认弹窗（需要回调）
  private _alertCallbacks = new Map<string, (action: string | null) => void>();
  private showConfirm(title: string, message: string, buttons: string[], level: 'info' | 'warn' | 'error' = 'warn'): Promise<string | null> {
    return new Promise(resolve => {
      const id = 'alert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      this._alertCallbacks.set(id, resolve);
      this._view?.webview.postMessage({ type: 'showAlert', id, title, message, level, buttons });
      // 超时兜底
      setTimeout(() => {
        if (this._alertCallbacks.has(id)) {
          this._alertCallbacks.delete(id);
          resolve(null);
        }
      }, 60000);
    });
  }

  /**
   * 检测 Windsurf 当前登录的账户（优先补丁命令，回退 auth API）
   */
  private async detectCurrentWindsurfAccount(): Promise<{ token: string; label: string; apiServerUrl?: string }> {
    let token = '';
    let label = '';
    let apiServerUrl = '';

    // 1. 补丁命令（最可靠，直接返回邮箱、apiKey 和 apiServerUrl）
    try {
      const cmds = await vscode.commands.getCommands(true);
      if (cmds.includes('windsurf.exportCurrentSessionWithShit')) {
        const r: any = await vscode.commands.executeCommand('windsurf.exportCurrentSessionWithShit');
        if (r && !r.error) {
          if (r.apiKey) token = r.apiKey;
          if (r.email) label = r.email;
          if (r.apiServerUrl) apiServerUrl = r.apiServerUrl;
        }
      }
    } catch { /* ignore */ }

    // 2. getAccounts（VS Code 1.85+，兜底拿 label）
    if (!label) {
      try {
        const api = vscode.authentication as any;
        if (typeof api.getAccounts === 'function') {
          const accts = await api.getAccounts('windsurf_auth');
          if (accts?.length) label = accts[0].label || accts[0].id || '';
        }
      } catch { /* ignore */ }
    }

    // 3. getSession 多 scope 尝试（兜底拿 token）
    if (!token) {
      const scopeSets: string[][] = [['login'], ['login', 'onboarding'], [], ['LOGIN']];
      for (const scopes of scopeSets) {
        try {
          const s = await vscode.authentication.getSession('windsurf_auth', scopes, { createIfNone: false });
          if (s?.accessToken) {
            token = s.accessToken;
            if (!label) label = s.account.label || s.account.id || '';
            break;
          }
        } catch { /* ignore */ }
      }
    }

    return { token, label, apiServerUrl };
  }

  /**
   * 刷新 webview
   */
  async refresh(skipAuth = false): Promise<void> {
    if (!this._view) return;

    const accounts = await accountStore.readAccounts(this._context);
    const poolLastEmail = this._context.globalState.get<string>('lastEmail') || '';

    let activeEmail = poolLastEmail;
    let externalAccount = '';

    if (!skipAuth) {
      const { token: realToken, label: realLabel } = await this.detectCurrentWindsurfAccount();

      if (realToken || realLabel) {
        const tokenMatch = realToken ? accounts.find(a => a.apiKey === realToken) : null;
        const emailMatch = realLabel ? accounts.find(a =>
          a.email === realLabel ||
          a.name === realLabel ||
          a.email === realLabel + '@windsurf.local'
        ) : null;
        const poolMatch = poolLastEmail ? accounts.find(a => a.email === poolLastEmail) : null;

        if (tokenMatch) {
          activeEmail = tokenMatch.email;
        } else if (emailMatch) {
          activeEmail = emailMatch.email;
        } else if (realLabel && realLabel.includes('@')) {
          // 拿到真实邮箱且号池里没有 → 外部账户
          activeEmail = '';
          externalAccount = realLabel;
        } else if (poolMatch) {
          // realLabel 不是邮箱（如显示名）→ 回退 poolLastEmail
          activeEmail = poolMatch.email;
        }

        if (activeEmail && poolLastEmail !== activeEmail) {
          await accountStore.setCurrentAccount(this._context, activeEmail);
        }
      }
    }

    this.postMessage({
      type: 'accountsChanged',
      accounts,
      lastEmail: activeEmail,
      externalAccount
    });

    // 同步当前实例邮箱到 instances.json（refresh 后 activeEmail 才可靠）
    if (activeEmail) {
      try {
        instanceManager.syncCurrentInstanceEmail(activeEmail);
        const instances = await instanceManager.listInstances();
        const myInst = instances.find(i => i.current);
        if (myInst && !myInst.bindEmail) {
          myInst.bindEmail = activeEmail;
        }
        this.postMessage({ type: 'instanceListResult', instances });
      } catch {}
    }
  }

  /**
   * 生成 webview HTML
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'main.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'main.js'));
    const extVersion = vscode.extensions.getExtension('local.windsurf-pool')?.packageJSON?.version || '0.0.0';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="app">

    <!-- Windsurf 增强面板（顶部，默认折叠） -->
    <div class="card enhance-card" id="enhanceArea">
      <details class="enhance-details" id="enhanceDetails">
        <summary class="enhance-summary">
          <svg class="enhance-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span class="enhance-title">Windsurf 增强</span>
          <span class="enhance-arrow"></span>
          <button class="enhance-toggle-btn" id="enhanceToggleBtn">未启用</button>
        </summary>
        <div class="enhance-body">
          <!-- 状态信息 -->
          <div class="enhance-status-row">
            <span class="enhance-label">增强脚本</span>
            <span class="enhance-value" id="enhanceScriptStatus">检测中…</span>
          </div>
          <div class="enhance-status-row">
            <span class="enhance-label">智能建议规则</span>
            <span class="enhance-value" id="enhanceBubbleRules">检测中…</span>
          </div>
          <div class="enhance-status-row">
            <span class="enhance-label">无感切号</span>
            <span class="enhance-value" id="enhanceSignalBridge">检测中…</span>
          </div>

          <!-- 操作按钮 -->
          <div class="enhance-actions">
            <button class="enhance-btn" id="enhanceReinjectBtn" title="重新注入增强脚本到 workbench.html">重新注入</button>
            <button class="enhance-btn" id="enhanceInjectRulesBtn" title="修改系统提示词（~/.windsurfrules）">修改系统提示词</button>
            <button class="enhance-btn enhance-btn--danger" id="enhanceRestoreBtn" title="恢复原始 workbench.html">恢复原始</button>
          </div>

          <!-- 回复建议提示设置 -->
          <div class="enhance-section">
            <div class="enhance-section-title">回复建议提示</div>
            <p class="enhance-hint">需先点击上方「修改系统提示词」注入规则后生效。</p>
            <label class="enhance-option">
              <input type="checkbox" id="enhBubblesEnabled" checked>
              <span>启用回复建议</span>
            </label>
            <label class="enhance-option">
              <input type="checkbox" id="enhBubblesAutoSend" checked>
              <span>点击自动发送</span>
            </label>
            <div class="enhance-option-row">
              <span class="enhance-option-label">主题</span>
              <select class="enhance-select" id="enhBubblesTheme">
                <option value="emerald">绿青蓝（翡翠）</option>
                <option value="aurora">紫粉（极光）</option>
                <option value="sunset">橙红（日落）</option>
                <option value="ocean">深蓝（海洋）</option>
                <option value="glass">透明（毛玻璃）</option>
                <option value="dark">暗夜</option>
              </select>
            </div>
            <div class="enhance-option-row">
              <span class="enhance-option-label">形状</span>
              <select class="enhance-select" id="enhBubblesShape">
                <option value="pill">胶囊</option>
                <option value="rounded" selected>圆角</option>
                <option value="soft">柔和</option>
                <option value="sharp">直角</option>
              </select>
            </div>
            <!-- 气泡预览 -->
            <div class="bubble-preview">
              <div class="bubble-preview-label">预览效果</div>
              <div class="bubble-preview-container" id="bubblePreviewContainer">
                <div class="bubble-preview-item" id="bubblePreview1">添加单元测试</div>
                <div class="bubble-preview-item" id="bubblePreview2">优化错误处理</div>
                <div class="bubble-preview-item" id="bubblePreview3">重构为组件化</div>
              </div>
            </div>
          </div>

          <!-- 界面汉化 -->
          <div class="enhance-section">
            <div class="enhance-section-title">界面汉化</div>
            <label class="enhance-option">
              <input type="checkbox" id="enhLocalizationEnabled" checked>
              <span>启用汉化</span>
            </label>
          </div>

          <!-- 自动操作 -->
          <div class="enhance-section enhance-section--checks">
            <div class="enhance-section-title">自动操作</div>
            <label class="enhance-option">
              <input type="checkbox" id="enhAutoContinueEnabled" checked>
              <span>回复截断时自动继续</span>
            </label>
            <label class="enhance-option">
              <input type="checkbox" id="enhDismissCorruptEnabled" checked>
              <span>自动关闭"文件损坏"通知</span>
            </label>
            <label class="enhance-option">
              <input type="checkbox" id="enhAutoSwitchOnQuota" checked>
              <span>额度耗尽时自动切号</span>
            </label>
            <label class="enhance-option">
              <input type="checkbox" id="enhAutoSwitchOnRateLimit" checked>
              <span>请求限流时自动切号</span>
            </label>
          </div>

          <!-- 自动恢复 -->
          <div class="enhance-section">
            <div class="enhance-section-title">自动恢复</div>
            <label class="enhance-option">
              <input type="checkbox" id="enhAutoRecoveryEnabled" checked>
              <span>启用自动恢复</span>
            </label>

            <!-- 网络超时 / 临时故障 -->
            <details class="enhance-rule-details" open>
              <summary class="enhance-rule-summary">网络超时 / 临时故障</summary>
              <div class="enhance-rule-body">
                <div class="enhance-option-row">
                  <span class="enhance-option-label">处理方式</span>
                  <select class="enhance-select" id="ruleNetworkAction" style="flex:1">
                    <option value="retry">自动重试</option>
                    <option value="switch-account">切换账号</option>
                    <option value="notify">仅通知</option>
                    <option value="ignore">忽略</option>
                  </select>
                </div>
                <div class="enhance-option-row" id="ruleNetworkRetryOpts">
                  <span class="enhance-option-label">最大重试</span>
                  <input type="number" class="enhance-select" id="ruleNetworkMaxRetries" value="3" min="1" max="10" style="width:48px;text-align:center">
                  <span class="enhance-option-label">次</span>
                  <span class="enhance-option-label" style="margin-left:8px">延迟</span>
                  <input type="number" class="enhance-select" id="ruleNetworkDelay" value="3" min="1" max="30" style="width:48px;text-align:center">
                  <span class="enhance-option-label">秒</span>
                </div>
                <button class="enhance-test-btn" id="testRetryBtn">测试重试</button>
                <div class="test-result" id="testRetryResult"></div>
              </div>
            </details>

            <!-- 配额耗尽 / 速率限制 -->
            <details class="enhance-rule-details" open>
              <summary class="enhance-rule-summary">配额耗尽 / 速率限制</summary>
              <div class="enhance-rule-body">
                <div class="enhance-option-row">
                  <span class="enhance-option-label">处理方式</span>
                  <select class="enhance-select" id="ruleQuotaAction" style="flex:1">
                    <option value="switch-account">切换账号</option>
                    <option value="switch-model">切换模型</option>
                    <option value="notify">仅通知</option>
                    <option value="ignore">忽略</option>
                  </select>
                </div>
                <div class="enhance-option-row">
                  <span class="enhance-option-label">切换后</span>
                  <select class="enhance-select" id="ruleQuotaAfterAction" style="flex:1">
                    <option value="auto">智能判断</option>
                    <option value="send-continue">发送继续</option>
                    <option value="retry-message">重发消息</option>
                    <option value="none">不操作</option>
                  </select>
                </div>
                <button class="enhance-test-btn" id="testSwitchAccountBtn">测试切号</button>
                <div class="test-result" id="testSwitchAccountResult"></div>
              </div>
            </details>

            <!-- 模型不可用 -->
            <details class="enhance-rule-details" open>
              <summary class="enhance-rule-summary">模型不可用</summary>
              <div class="enhance-rule-body">
                <div class="enhance-option-row">
                  <span class="enhance-option-label">处理方式</span>
                  <select class="enhance-select" id="ruleModelAction" style="flex:1">
                    <option value="switch-model">切换模型</option>
                    <option value="switch-account">切换账号</option>
                    <option value="retry">自动重试</option>
                    <option value="notify">仅通知</option>
                    <option value="ignore">忽略</option>
                  </select>
                </div>
                <div class="enhance-option-row">
                  <span class="enhance-option-label">切换后</span>
                  <select class="enhance-select" id="ruleModelAfterAction" style="flex:1">
                    <option value="send-continue">发送继续</option>
                    <option value="auto">智能判断</option>
                    <option value="retry-message">重发消息</option>
                    <option value="none">不操作</option>
                  </select>
                </div>
                <div class="enhance-option-row" style="flex-wrap:wrap;gap:4px">
                  <span class="enhance-option-label" style="width:100%">模型优先级（拖拽排序）</span>
                  <div class="enhance-option-row" style="margin-bottom:4px">
                    <button class="enhance-test-btn" id="fetchModelsBtn" style="flex:1">获取可用模型列表</button>
                  </div>
                  <div id="modelPriorityList" class="model-priority-list"></div>
                  <div id="availableModelsList" class="available-models-list" style="display:none"></div>
                  <div class="enhance-option-row" style="margin-top:4px">
                    <input type="text" class="enhance-select" id="modelPriorityInput" placeholder="手动输入模型名..." style="flex:1">
                    <button class="enhance-test-btn" id="modelPriorityAdd">添加</button>
                  </div>
                </div>
                <div class="enhance-option-row" style="margin-top:4px;gap:4px">
                  <span class="enhance-option-label">当前模型:</span>
                  <span id="currentModelName" style="font-size:12px;color:var(--accent)">-</span>
                </div>
                <div class="enhance-option-row" style="gap:4px">
                  <button class="enhance-test-btn" id="testSwitchModelBtn" style="flex:1">测试切换模型</button>
                </div>
                <div class="test-result" id="testSwitchModelResult"></div>
              </div>
            </details>

            <!-- 工具调用上限 / 响应截断 -->
            <details class="enhance-rule-details">
              <summary class="enhance-rule-summary">工具调用上限 / 响应截断</summary>
              <div class="enhance-rule-body">
                <div class="enhance-option-row">
                  <span class="enhance-option-label">处理方式</span>
                  <select class="enhance-select" id="ruleContinuationAction" style="flex:1">
                    <option value="send-continue">发送继续</option>
                    <option value="notify">仅通知</option>
                    <option value="ignore">忽略</option>
                  </select>
                </div>
                <label class="enhance-option">
                  <input type="checkbox" id="enhAutoSendContinue" checked>
                  <span>自动发送 continue</span>
                </label>
                <button class="enhance-test-btn" id="testSendContinueBtn">测试发送 continue</button>
                <div class="test-result" id="testSendContinueResult"></div>
              </div>
            </details>

            <!-- 权限请求 -->
            <details class="enhance-rule-details">
              <summary class="enhance-rule-summary">权限请求</summary>
              <div class="enhance-rule-body">
                <div class="enhance-option-row">
                  <span class="enhance-option-label">处理方式</span>
                  <select class="enhance-select" id="rulePermissionAction" style="flex:1">
                    <option value="auto-allow">自动允许</option>
                    <option value="notify">仅通知</option>
                  </select>
                </div>
                <div id="permissionScopeOpts">
                  <label class="enhance-option"><input type="checkbox" id="permScopeWeb" checked><span>Web 请求</span></label>
                  <label class="enhance-option"><input type="checkbox" id="permScopeTerminal"><span>终端命令</span></label>
                  <label class="enhance-option"><input type="checkbox" id="permScopeFile"><span>文件写入</span></label>
                </div>
                <button class="enhance-test-btn" id="testPermissionBtn">测试权限检测</button>
                <div class="test-result" id="testPermissionResult"></div>
              </div>
            </details>

            <!-- 需要用户介入 -->
            <details class="enhance-rule-details">
              <summary class="enhance-rule-summary">需要用户介入</summary>
              <div class="enhance-rule-body">
                <div class="enhance-option-row">
                  <span class="enhance-option-label">处理方式</span>
                  <select class="enhance-select" id="ruleUserAction" style="flex:1">
                    <option value="notify">仅通知</option>
                    <option value="ignore">忽略</option>
                  </select>
                </div>
                <p class="enhance-hint" style="margin:4px 0 0;font-size:11px;opacity:0.6">登录失效、上下文过长、版本过期等</p>
              </div>
            </details>

            <!-- 自定义规则 -->
            <details class="enhance-rule-details">
              <summary class="enhance-rule-summary">自定义规则</summary>
              <div class="enhance-rule-body">
                <div id="customRulesList"></div>
                <div class="enhance-option-row" style="margin-top:4px">
                  <button class="enhance-test-btn" id="customRuleAdd" style="width:100%">+ 添加规则</button>
                </div>
              </div>
            </details>

            <!-- 恢复历史日志 -->
            <details class="enhance-recovery-log-details">
              <summary class="enhance-recovery-log-summary">
                <span>恢复历史日志</span>
                <span class="recovery-log-count" id="recoveryLogCount">0</span>
              </summary>
              <div class="enhance-recovery-log-toolbar">
                <select class="enhance-select" id="recoveryLogFilter" style="flex:1">
                  <option value="">全部分类</option>
                  <option value="networkErrors">网络超时</option>
                  <option value="quotaErrors">配额耗尽</option>
                  <option value="modelErrors">模型不可用</option>
                  <option value="continuationErrors">响应截断</option>
                  <option value="permissionRequests">权限请求</option>
                  <option value="userIntervention">用户介入</option>
                  <option value="custom">自定义规则</option>
                </select>
                <button class="enhance-test-btn" id="recoveryLogRefresh" title="刷新">刷新</button>
                <button class="enhance-test-btn" id="recoveryLogClear" title="清空">清空</button>
              </div>
              <div class="recovery-log-list" id="recoveryLogList"></div>
            </details>
          </div>

          <!-- 完成提醒 -->
          <div class="enhance-section">
            <div class="enhance-section-title">完成提醒</div>
            <p class="enhance-hint">AI 回复完成或出现异常时播放提示音 / 弹桌面通知。</p>
            <label class="enhance-option">
              <input type="checkbox" id="enhNotifyEnabled" checked>
              <span>启用完成提醒</span>
            </label>
            <div class="enhance-option-row">
              <span class="enhance-option-label">触发条件</span>
              <select class="enhance-select" id="enhNotifyTrigger" style="flex:1">
                <option value="always">每次都响</option>
                <option value="error">仅异常时</option>
                <option value="idle">仅窗口不活跃时</option>
              </select>
            </div>
            <div class="enhance-option-row" style="gap:12px">
              <label class="enhance-option" style="margin:0">
                <input type="checkbox" id="enhNotifySound" checked>
                <span>响铃</span>
              </label>
              <label class="enhance-option" style="margin:0">
                <input type="checkbox" id="enhNotifyDesktop" checked>
                <span>桌面通知</span>
              </label>
            </div>
            <div class="enhance-option-row">
              <span class="enhance-option-label">铃声</span>
              <select class="enhance-select" id="enhNotifyTone" style="flex:1">
                <option value="funk">Funk</option>
                <option value="ding">Ding</option>
                <option value="chime">Chime</option>
                <option value="beep">Beep</option>
                <option value="custom">自定义音符</option>
                <option value="file">音频文件</option>
              </select>
              <button class="enhance-test-btn" id="enhNotifyTest" title="试听">试听</button>
            </div>
            <div class="enhance-option-row" id="enhCustomToneRow" style="display:none">
              <span class="enhance-option-label">自定义音符</span>
              <input type="text" class="enhance-select" id="enhCustomTone" style="flex:1" placeholder="频率:时长, ... 如 880:200,0:50,660:200" title="格式: 频率Hz:时长ms，逗号分隔。0表示静音">
            </div>
            <div class="enhance-option-row" id="enhAudioFileRow" style="display:none">
              <span class="enhance-option-label">文件路径</span>
              <input type="text" class="enhance-select" id="enhAudioFile" style="flex:1" placeholder="音频文件路径（.wav / .mp3）" title="支持 .wav / .mp3 文件">
              <button class="enhance-test-btn" id="enhAudioFileBrowse" title="浏览">📂</button>
            </div>
            <div class="enhance-option-row">
              <span class="enhance-option-label">响铃次数</span>
              <input type="number" class="enhance-select" id="enhNotifyRepeat" value="2" min="1" max="5" style="width:48px;text-align:center">
              <span class="enhance-option-label">次（1-5，间隔 ~600ms）</span>
            </div>
          </div>

        </div>
      </details>
    </div>

    <!-- 多实例管理面板 -->
    <div class="card instance-card" id="instanceArea">
      <details class="inst-details" id="instDetails" open>
        <summary class="inst-summary">
          <svg class="inst-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          <span class="inst-title" title="同时开多个 Windsurf 窗口，每个窗口登不同账号，可以同时用同一个项目">多实例分身</span>
          <span class="inst-arrow"></span>
          <div style="flex:1"></div>
          <button class="inst-import-btn" id="instImportBtn" title="从 Cockpit Tools 导入">Cockpit</button>
          <button class="inst-add-btn" id="instAddBtn" title="新建实例">+</button>
          <button class="inst-refresh-btn" id="instRefreshBtn" title="刷新">
            <svg width="16" height="16" viewBox="0 0 1402 1024" fill="currentColor"><path d="M136.479 521.213a45.223 45.223 0 0 1-30.526-78.01l156.02-145.845a45.223 45.223 0 0 1 62.182 1.13l149.237 145.845a45.223 45.223 0 0 1-63.313 64.443L291.369 392.326 167.005 508.776a45.223 45.223 0 0 1-30.526 12.437zM1051.12 740.545a45.223 45.223 0 0 1-30.526-12.436L863.443 582.264a45.596 45.596 1 1 62.182-66.704l124.364 117.58 118.711-116.45a45.223 45.223 0 0 1 63.313 64.443l-149.237 146.976a45.223 45.223 0 0 1-31.656 12.436z"/><path d="M1048.859 737.154a45.223 45.223 0 0 1-45.224-45.224V513.298c0-183.154-149.236-332.391-332.391-332.391a332.391 332.391 0 0 0-218.202 81.402 45.255 45.255 0 0 1-59.921-67.835 422.838 422.838 0 0 1 700.961 318.824v178.632a45.223 45.223 0 0 1-45.223 45.224zM671.244 933.875a422.838 422.838 0 0 1-422.838-422.838V332.405a45.223 45.223 0 0 1 90.447 0v178.632c0 183.154 149.237 332.391 332.391 332.391a331.261 331.261 0 0 0 223.856-87.055 45.223 45.223 0 0 1 61.051 66.705 421.707 421.707 0 0 1-284.907 110.797z"/></svg>
          </button>
        </summary>
        <div class="inst-body">
          <div id="instList" class="inst-list"></div>
          <div id="instEmpty" class="inst-empty" hidden>暂无实例，点击 + 新建</div>
        </div>
      </details>
    </div>

    <!-- 新建实例模态框 -->
    <div id="instCreateOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(400px,92vw)">
        <div class="modal-header">
          <h3>新建实例</h3>
          <button class="modal-close" id="instCreateClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <label>实例名称</label>
          <input type="text" id="instCreateName" placeholder="例如：工作号、测试号">
          <label>绑定账号</label>
          <div id="instCreateAccount" class="account-picker"></div>
          <div class="inst-create-hint">新实例将复制当前 Windsurf 环境，启动后自动登录所选账号</div>
          <div id="instCreateError" class="inst-error" hidden></div>
          <button class="primary inst-create-submit" id="instCreateSubmit">创建实例</button>
        </div>
      </div>
    </div>

    <!-- Cockpit Tools 导入模态框 -->
    <div id="cockpitImportOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(480px,94vw)">
        <div class="modal-header">
          <h3>从 Cockpit Tools 导入</h3>
          <button class="modal-close" id="cockpitImportClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <div id="cockpitList" class="cockpit-list"></div>
          <div id="cockpitEmpty" class="cockpit-empty" hidden>未找到 Cockpit Tools 实例</div>
        </div>
      </div>
    </div>

    <!-- Cockpit 导入填表模态框（第二步） -->
    <div id="cockpitFormOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(400px,92vw)">
        <div class="modal-header">
          <h3>导入 Cockpit 实例</h3>
          <button class="modal-close" id="cockpitFormClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <label>实例名称</label>
          <input type="text" id="cockpitFormName" placeholder="例如：工作号、测试号">
          <label>绑定账号</label>
          <div id="cockpitFormAccount" class="account-picker"></div>
          <div class="inst-create-hint">导入后，启动该实例时会自动登录所选账号。原 Cockpit 数据目录保留不变。</div>
          <div id="cockpitFormError" class="inst-error" hidden></div>
          <button class="primary inst-create-submit" id="cockpitFormSubmit">确认导入</button>
        </div>
      </div>
    </div>

    <!-- 实例编辑模态框 -->
    <div id="instEditOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(400px,92vw)">
        <div class="modal-header">
          <h3>编辑实例</h3>
          <button class="modal-close" id="instEditClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <label>实例名称</label>
          <input type="text" id="instEditName">
          <label>绑定账号</label>
          <div id="instEditAccount" class="account-picker"></div>
          <label>自动切号标签分组</label>
          <select id="instEditTag" class="as-select" style="width:100%">
            <option value="">不限（全部账号）</option>
          </select>
          <div id="instEditError" class="inst-error" hidden></div>
          <button class="primary inst-create-submit" id="instEditSubmit">保存</button>
        </div>
      </div>
    </div>

    <!-- 通用确认对话框 -->
    <div id="confirmOverlay" class="modal-overlay" hidden>
      <div class="modal-box" style="width:min(360px,90vw)">
        <div class="modal-header">
          <h3 id="confirmTitle">确认</h3>
          <button class="modal-close" id="confirmClose" title="关闭">×</button>
        </div>
        <div class="modal-body">
          <div id="confirmMsg" style="font-size:13px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="modal-cancel-btn" id="confirmCancel">取消</button>
            <button class="primary" id="confirmOk">确定</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 自动切号面板 -->
    <div class="card auto-switch-card" id="autoSwitchArea">
      <details class="as-details" id="asDetails" open>
        <summary class="as-top-summary">
          <svg class="as-top-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          <span class="as-top-title">自动切号</span>
          <span class="as-top-arrow"></span>
          <label class="as-switch" onclick="event.stopPropagation()">
            <input type="checkbox" id="asEnabled" checked>
            <span class="as-switch-track"><span class="as-switch-thumb"></span></span>
          </label>
        </summary>
        <div class="as-body" id="asBody">
          <div class="as-grid">
            <div class="as-grid-item">
              <span class="as-grid-label">阈值</span>
              <div class="as-field">
                <span class="as-field-label">低于</span>
                <input type="number" class="as-num-input" id="asThreshold" value="10" min="1" max="99">
                <span class="as-field-label">% 切换</span>
              </div>
            </div>
            <div class="as-grid-item">
              <span class="as-grid-label">检查</span>
              <div class="as-field">
                <span class="as-field-label">每</span>
                <input type="number" class="as-num-input" id="asCheckInterval" value="60" min="10" max="600" style="width:50px">
                <span class="as-field-label">秒</span>
              </div>
            </div>
            <div class="as-grid-item">
              <span class="as-grid-label">冷却</span>
              <div class="as-field">
                <input type="number" class="as-num-input" id="asCooldown" value="30" min="5" max="300" style="width:50px">
                <span class="as-field-label">秒</span>
              </div>
            </div>
            <div class="as-grid-item">
              <span class="as-grid-label">策略</span>
              <div class="as-field">
                <select id="asScoreMode" class="as-select">
                  <option value="min">智能</option>
                  <option value="daily">仅日配额</option>
                  <option value="weekly">仅周配额</option>
                </select>
              </div>
            </div>
            <div class="as-grid-item">
              <span class="as-grid-label">范围</span>
              <div class="as-field">
                <select id="asPoolScope" class="as-select">
                  <option value="all">全部账号</option>
                  <option value="tag">按标签</option>
                  <option value="instance">当前实例分组</option>
                </select>
                <select id="asPoolTag" class="as-select" style="display:none">
                  <!-- 动态填充标签列表 -->
                </select>
              </div>
            </div>
          </div>
          <div class="as-hint" id="asHint">取 min(日配额, 周配额) 作为评分，任一配额低于阈值即触发切号。</div>

          <!-- 切号策略配置 -->
          <div class="as-strategy-section">
            <div class="as-strategy-title">切号策略配置</div>
            <p class="as-strategy-desc">决定自动切号 / 错误切号挑下一个号的优先级。</p>
            <div class="as-strategy-heading">策略</div>
            <label class="as-strategy-option">
              <input type="radio" name="asSwitchStrategy" value="lowestNonZero" checked>
              <div class="as-strategy-content">
                <strong>最低非零优先（推荐）</strong>
                <span class="as-strategy-explain">优先用低额度但还没用完的号，把剩余消耗完再用满额度号。避开周/日额度为 0 的号。</span>
              </div>
            </label>
            <label class="as-strategy-option">
              <input type="radio" name="asSwitchStrategy" value="highestFirst">
              <div class="as-strategy-content">
                <strong>满额度优先（旧策略）</strong>
                <span class="as-strategy-explain">优先用额度最高的号。可能造成低额度号永远用不到。</span>
              </div>
            </label>
            <div class="as-strategy-heading" style="margin-top:10px">额度下限 (minQuota)</div>
            <div class="as-field">
              <input type="number" class="as-num-input" id="asMinQuota" value="10" min="0" max="50" style="width:50px">
              <span class="as-field-label">%（低于此值视作"额度耗尽"，挑号时排除）</span>
            </div>
            <div class="as-strategy-heading" style="margin-top:8px">已用号阈值 (preferUsedThreshold)</div>
            <div class="as-field">
              <input type="number" class="as-num-input" id="asPreferUsedThreshold" value="50" min="10" max="90" style="width:50px">
              <span class="as-field-label">%（≤ 此值视为"已经在用"，先消耗完它）</span>
            </div>
          </div>
          <div id="autoSwitchStatus" class="as-status" hidden></div>
          <pre id="autoSwitchLog" class="as-log" hidden></pre>
        </div>
      </details>
    </div>

    <!-- 额度汇总面板 -->
    <div class="card summary-card" id="summaryCard" hidden>
      <div class="summary-header">
        <div class="summary-title-wrap">
          <svg class="summary-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span class="summary-title">号池汇总</span>
        </div>
        <span class="summary-count" id="summaryCount">0 账号</span>
      </div>
      <div class="summary-stats">
        <div class="summary-stat" id="summaryDailyStat">
          <div class="summary-stat-head">
            <svg class="summary-stat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            <span class="summary-stat-label">本日</span>
            <span class="summary-stat-pct" id="summaryDailyPct">0%</span>
          </div>
          <div class="summary-bar"><div class="summary-bar-fill" id="summaryDailyBar" style="width:0%"></div></div>
          <div class="summary-stat-footer">
            <span class="summary-stat-num" id="summaryDailyNum">0</span>
            <span class="summary-stat-max" id="summaryDailyMax">/ 0</span>
          </div>
        </div>
        <div class="summary-stat" id="summaryWeeklyStat">
          <div class="summary-stat-head">
            <svg class="summary-stat-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span class="summary-stat-label">本周</span>
            <span class="summary-stat-pct" id="summaryWeeklyPct">0%</span>
          </div>
          <div class="summary-bar"><div class="summary-bar-fill" id="summaryWeeklyBar" style="width:0%"></div></div>
          <div class="summary-stat-footer">
            <span class="summary-stat-num" id="summaryWeeklyNum">0</span>
            <span class="summary-stat-max" id="summaryWeeklyMax">/ 0</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 外部账户提示条 -->
    <div id="externalBanner" class="external-banner" hidden>
      <span class="external-banner-text">
        当前 Windsurf 登录的账户 <strong id="externalEmail"></strong> 不在号池中
      </span>
      <button class="external-banner-btn" id="externalAddBtn">加入号池</button>
    </div>

    <!-- 账号列表区域 -->
    <div class="card list-card">
      <details class="list-details" id="listDetails" open>
        <summary class="list-summary">
          <svg class="list-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <h3>我的账号</h3>
          <span class="grid-count" id="gridCount">0 个</span>
          <span class="list-arrow"></span>
          <div style="flex:1"></div>
          <button class="add-account-btn" id="addAccountBtn">添加账号</button>
        </summary>
        <div class="list-body">
      <!-- 搜索栏 -->
      <div class="search-bar" id="searchBar">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="search-input" id="searchInput" placeholder="搜索账号..." autocomplete="off">
        <button class="search-clear" id="searchClear" hidden title="清除">×</button>
      </div>
      <!-- 工具栏：过滤 + 排序 + 刷新 -->
      <div class="toolbar-bar" id="toolbarBar">
        <div class="filter-wrap" id="filterWrap">
          <button class="filter-trigger" id="filterTrigger" title="过滤">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span id="filterLabel">ALL</span>
            <span class="filter-count" id="filterCount"></span>
          </button>
          <div class="filter-dropdown" id="filterDropdown" hidden>
            <div class="filter-section" id="filterPlanSection">
              <div class="filter-section-title">套餐</div>
              <div class="filter-options" id="filterPlanList"></div>
            </div>
            <div class="filter-section" id="filterTagSection">
              <div class="filter-section-title">标签</div>
              <div class="filter-options" id="filterTagList"></div>
            </div>
            <div class="filter-section" id="filterStatusSection">
              <div class="filter-section-title">状态</div>
              <div class="filter-options" id="filterStatusList"></div>
            </div>
            <div class="filter-actions">
              <button class="filter-clear-btn" id="filterClearBtn">清空筛选</button>
            </div>
          </div>
        </div>
        <select class="group-select" id="sortSelect" title="排序方式">
          <option value="default">默认排序</option>
          <option value="recommend">⭐ 推荐</option>
          <option value="min">综合配额</option>
          <option value="daily">日配额</option>
          <option value="weekly">周配额</option>
          <option value="planEnd">到期日</option>
          <option value="email">邮箱 A-Z</option>
          <option value="created">添加时间</option>
        </select>
        <button class="sort-direction-btn" id="sortDirectionBtn" title="切换排序方向">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <polyline points="19 12 12 19 5 12"/>
          </svg>
        </button>
        <button class="toolbar-icon-btn" id="refreshAllBtn" title="刷新全部配额">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <div style="flex:1"></div>
        <select class="page-size-select" id="pageSizeSelect" title="每页显示">
          <option value="10">10/页</option>
          <option value="20" selected>20/页</option>
          <option value="50">50/页</option>
          <option value="0">全部</option>
        </select>
        <button class="group-select-mode-btn" id="selectModeBtn" title="多选模式">多选</button>
      </div>
      <!-- 标签管理栏 -->
      <div class="tag-bar" id="tagBar">
        <span class="tag-bar-label">标签:</span>
        <div class="tag-list" id="tagList">
          <!-- 动态生成的标签 -->
        </div>
      </div>
      <!-- 批量操作栏（多选模式下显示） -->
      <div class="batch-bar" id="batchBar" hidden>
        <label class="batch-check-all"><input type="checkbox" id="batchCheckAll"><span>全选</span></label>
        <div style="flex:1"></div>
        <span class="batch-count" id="batchCount">已选 0</span>
        <button class="batch-action-btn" id="batchTagBtn" title="为选中账号设置标签">加标签</button>
        <button class="batch-action-btn" id="batchEnableBtn" title="启用选中账号">启用</button>
        <button class="batch-action-btn" id="batchDisableBtn" title="禁用选中账号">禁用</button>
        <button class="batch-action-btn batch-action-delete" id="batchDeleteBtn" title="删除选中账号">删除</button>
        <button class="batch-action-btn" id="batchCancelBtn">取消</button>
      </div>
        <div id="accountGrid" class="account-grid"></div>
        <div id="emptyState" class="empty-card">
          <div class="empty-title">还没有账号</div>
          <div class="empty-sub">点击上方 + 按钮添加账号</div>
        </div>
      </div>
    </details>
    </div>

  </div>

  <!-- 添加账号模态框 -->
  <div id="addAccountOverlay" class="modal-overlay" hidden>
    <div class="modal-box" style="width:min(480px,94vw);max-height:88vh">
      <div class="modal-header">
        <h3>添加账号</h3>
        <button class="modal-close" id="addAccountClose" title="关闭">×</button>
      </div>
      <div class="modal-body">
        <div class="add-tabs">
          <button class="add-tab active" data-tab="batch">批量导入</button>
          <button class="add-tab" data-tab="single">单个登录</button>
          <button class="add-tab" data-tab="current">已登录账户</button>
        </div>

        <!-- 单个登录 -->
        <div id="singleLoginArea" hidden>
          <label>邮箱</label>
          <input type="email" id="email" placeholder="your@email.com">
          <label>密码</label>
          <input type="password" id="loginPassword" placeholder="密码">
          <label>标签（可选）</label>
          <input type="text" id="loginTag" placeholder="如：工作号、测试号">
          <button class="primary" data-action="loginSave" style="margin-top:10px">登录并保存</button>
        </div>

        <!-- 批量导入 -->
        <div id="batchImportArea">
          <div class="batch-section">
            <label class="batch-mode-label">导入标签</label>
            <input type="text" id="batchTag" class="batch-tag-input" placeholder="为本批导入的账号设置标签（可选）">
          </div>
          <div class="batch-section">
            <label class="batch-mode-label">导入格式</label>
            <div class="batch-radio-group">
              <label class="batch-radio"><input type="radio" name="batchFormat" value="text" checked> 文本</label>
              <label class="batch-radio"><input type="radio" name="batchFormat" value="json"> JSON 格式</label>
            </div>
          </div>

          <div class="batch-section">
            <label class="batch-mode-label">登录方式</label>
            <div class="batch-radio-group">
              <label class="batch-radio"><input type="radio" name="batchAuthMethod" value="auto" checked> 自动</label>
              <label class="batch-radio"><input type="radio" name="batchAuthMethod" value="auth1"> Auth1</label>
              <label class="batch-radio"><input type="radio" name="batchAuthMethod" value="firebase"> Firebase</label>
            </div>
          </div>

          <div id="batchTextArea" class="batch-text-area">
            <div class="batch-section">
              <label class="batch-mode-label">分隔符</label>
              <div class="batch-radio-group batch-radio-group--wrap">
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="----" checked> ----</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="\\t"> Tab</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value=" "> 空格</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value=","> 逗号</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="|"> 竖线</label>
                <label class="batch-radio"><input type="radio" name="batchDelimRadio" value="custom"> 自定义</label>
              </div>
              <input type="text" id="batchCustomDelim" class="batch-custom-delim" placeholder="输入自定义分隔符" hidden>
            </div>
            <select id="batchDelimiter" hidden><option value="----">----</option><option value="\\t">Tab</option><option value=" ">空格</option><option value=",">逗号</option><option value="|">竖线</option><option value="custom">自定义</option></select>

            <label class="batch-hint">每行一组: 邮箱{分隔符}密码 — 或直接粘贴以 auth1_ 开头的 token 自动识别</label>
            <textarea id="batchText" class="batch-textarea" rows="6" placeholder="user1@example.com----password123&#10;user2@example.com----abc456789&#10;auth1_xxxx... (直接粘 auth1_ token 也行)"></textarea>

            <details class="batch-example">
              <summary>格式示例（点击展开）</summary>
              <div class="batch-example-content">
                <div class="batch-example-label">文本示例</div>
                <pre class="batch-example-code">user1@example.com----password123
user2@example.com----abc456789</pre>
              </div>
            </details>

            <button class="primary" data-action="batchImportText">批量导入</button>
          </div>

          <div id="batchJsonArea" hidden>
            <label>JSON 数据</label>
            <textarea id="batchJson" class="batch-textarea" rows="6" placeholder='[{"email":"user1@example.com","password":"pass1"},{"email":"user2@example.com","password":"pass2"}]'></textarea>

            <details class="batch-example">
              <summary>格式示例（点击展开）</summary>
              <div class="batch-example-content">
                <div class="batch-example-label">JSON 示例</div>
                <pre class="batch-example-code">[
  {"email": "user1@example.com", "password": "pass1"},
  {"email": "user2@example.com", "password": "pass2"}
]</pre>
              </div>
            </details>

            <button class="primary" data-action="batchImportJson">批量导入</button>
          </div>

          <div id="batchMsg" class="batch-msg" hidden></div>
        </div>

        <!-- 从当前已登录账户添加 -->
        <div id="currentAccountArea" hidden>
          <p class="footnote">将 Windsurf 当前已登录账户的 Session 保存到号池，无需密码。</p>
          <button class="primary" data-action="addCurrent" style="margin-top:10px">从当前账户添加</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量导入模态进度弹窗 -->
  <div id="batchModalOverlay" class="modal-overlay" hidden>
    <div class="modal-box">
      <div class="modal-header">
        <h3 id="batchModalTitle">批量导入中</h3>
        <button class="modal-close" id="batchModalClose" title="关闭" hidden>×</button>
      </div>
      <div class="modal-body">
        <div class="modal-progress-bar"><div class="modal-progress-fill" id="batchModalFill"></div></div>
        <div class="modal-progress-text" id="batchModalProgressText">准备中…</div>
        <div class="modal-current" id="batchModalCurrent"></div>
        <div class="modal-counts" id="batchModalCounts"></div>
        <div class="modal-fail-list" id="batchModalFailList" hidden></div>
        <button class="modal-retry-btn" id="batchModalRetry" hidden>重试失败项</button>
        <button class="modal-done-btn" id="batchModalDone" hidden>完成</button>
      </div>
    </div>
  </div>

  <!-- 通用提示/确认模态弹窗 -->
  <div id="alertOverlay" class="modal-overlay" hidden>
    <div class="modal-box" style="width:min(360px,90vw)">
      <div class="modal-header">
        <h3 id="alertTitle">提示</h3>
        <button class="modal-close" id="alertCloseX" title="关闭">×</button>
      </div>
      <div class="modal-body">
        <div id="alertMessage" style="font-size:12.5px;line-height:1.6;word-break:break-word;"></div>
        <div id="alertActions" class="alert-actions"></div>
      </div>
    </div>
  </div>

  <!-- 标签编辑弹窗 -->
  <div id="tagEditOverlay" class="modal-overlay" hidden>
    <div class="modal-box" style="width:min(360px,90vw)">
      <div class="modal-header">
        <h3 id="tagEditTitle">编辑标签</h3>
        <button class="modal-close" id="tagEditClose" title="关闭">×</button>
      </div>
      <div class="modal-body">
        <label>标签名称</label>
        <input type="text" id="tagEditInput" placeholder="输入标签名称">
        <div id="tagEditError" class="inst-error" hidden></div>
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
          <button class="modal-cancel-btn" id="tagEditCancel">取消</button>
          <button class="primary" id="tagEditSave">保存</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 全局 Toast 容器（实例操作进度/错误） -->
  <div id="toastContainer" class="toast-container"></div>

  <script>const vscode = acquireVsCodeApi();</script>
  <script>${getSignalBridgeScript()}</script>
  <script src="${jsUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this._disposables.forEach(d => d.dispose());
  }
}
