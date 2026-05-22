const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const MARKER = 'a8-auto-continue.js';
const SCRIPT_TAG_RE = /<script\b[^>]*\bsrc=["']\.\/a8-auto-continue\.js(?:\?[^"']*)?["'][^>]*><\/script>\s*/gi;
const EXT_VERSION = '1.0.1'; // 每次发版更新此版本号，用于检测安装/升级

let statusBarItem = null;

// ---------- 重载提示 ----------

async function promptReload(message) {
    const choice = await vscode.window.showInformationMessage(
        message,
        '立即重载窗口'
    );
    if (choice) {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

// ---------- 路径工具 ----------

function getWorkbenchHtmlPath() {
    const appRoot = vscode.env.appRoot;
    if (appRoot) {
        return path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
    }
    if (process.platform === 'win32') {
        return 'C:\\Windsurf\\resources\\app\\out\\vs\\code\\electron-browser\\workbench\\workbench.html';
    }
    return null;
}

function getScriptTargetPath(workbenchPath) {
    return path.join(path.dirname(workbenchPath), 'a8-auto-continue.js');
}

// ---------- 脚本标签构建 ----------

function buildScriptTag(config) {
    const params = new URLSearchParams();
    if (config.continue !== false) params.set('continue', '1');
    if (config.window != null) params.set('window', String(config.window));
    if (config.limit != null) params.set('limit', String(config.limit));
    if (config.text && config.text.trim()) params.set('text', config.text);
    return '<script src="./a8-auto-continue.js?' + params.toString() + '" defer></script>';
}

// ---------- 读取配置 ----------

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('autoContinue');
    return {
        enabled: cfg.get('enabled', true),
        text: cfg.get('text', 'Continue') || 'Continue',
        window: cfg.get('windowMs', 600000),
        limit: cfg.get('limitCount', 3),
        cooldown: cfg.get('cooldownMs', 3000),
    };
}

// ---------- 注入 / 移除 ----------

async function inject(config) {
    const workbenchPath = getWorkbenchHtmlPath();
    if (!workbenchPath) {
        vscode.window.showErrorMessage('[Auto Continue] 无法找到 Windsurf workbench.html 路径');
        return 'error';
    }

    try {
        // 1. 复制 auto-continue.js 到 workbench 目录
        const srcScript = path.join(__dirname, 'auto-continue.js');
        const dstScript = getScriptTargetPath(workbenchPath);
        const scriptContent = await fs.promises.readFile(srcScript, 'utf-8');
        await fs.promises.writeFile(dstScript, scriptContent, 'utf-8');

        // 2. 注入脚本标签到 workbench.html
        let html = await fs.promises.readFile(workbenchPath, 'utf-8');

        if (html.includes(MARKER)) {
            html = html.replace(SCRIPT_TAG_RE, buildScriptTag(config) + '\n');
            await fs.promises.writeFile(workbenchPath, html, 'utf-8');
            console.log('[Auto Continue] 脚本标签已更新');
            return 'updated';
        } else {
            const tag = '\t' + buildScriptTag(config) + '\n';
            if (html.includes('</body>')) {
                html = html.replace('</body>', tag + '</body>');
            } else {
                html += '\n' + tag;
            }
            await fs.promises.writeFile(workbenchPath, html, 'utf-8');
            console.log('[Auto Continue] 脚本已注入到 workbench.html');
            return 'injected';
        }
    } catch (err) {
        if (err.code === 'EACCES' || err.code === 'EPERM') {
            vscode.window.showErrorMessage(
                '[Auto Continue] 权限不足，请以管理员身份运行 Windsurf 后再试。'
            );
        } else {
            vscode.window.showErrorMessage('[Auto Continue] 注入失败: ' + err.message);
        }
        console.error('[Auto Continue] 注入错误:', err);
        return 'error';
    }
}

async function remove() {
    const workbenchPath = getWorkbenchHtmlPath();
    if (!workbenchPath) return false;

    try {
        let html = await fs.promises.readFile(workbenchPath, 'utf-8');
        if (!html.includes(MARKER)) return true;

        html = html.replace(SCRIPT_TAG_RE, '');
        await fs.promises.writeFile(workbenchPath, html, 'utf-8');
        console.log('[Auto Continue] 脚本标签已从 workbench.html 移除');
        return true;
    } catch (err) {
        console.error('[Auto Continue] 移除错误:', err);
        return false;
    }
}

// ---------- 状态栏 ----------

function updateStatusBar(enabled) {
    if (!statusBarItem) return;
    if (enabled) {
        statusBarItem.text = '$(sync) 自动续聊';
        statusBarItem.tooltip = 'Auto Continue: 已开启 — 点击切换';
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(sync-ignored) 自动续聊';
        statusBarItem.tooltip = 'Auto Continue: 已关闭 — 点击切换';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
}

// ---------- 命令处理 ----------

async function handleToggle(context) {
    const config = getConfig();
    const targetCfg = vscode.workspace.getConfiguration('autoContinue');
    const newEnabled = !config.enabled;

    if (newEnabled) {
        const ok = await inject(config);
        if (ok !== 'error') {
            await targetCfg.update('enabled', true, vscode.ConfigurationTarget.Global);
            await context.globalState.update('acEnabled', true);
            updateStatusBar(true);
            await promptReload('[Auto Continue] 已开启。需要重载窗口才能生效，是否立即重载？');
        }
    } else {
        const ok = await remove();
        if (ok) {
            await targetCfg.update('enabled', false, vscode.ConfigurationTarget.Global);
            await context.globalState.update('acEnabled', false);
            updateStatusBar(false);
            await promptReload('[Auto Continue] 已关闭。需要重载窗口才能生效，是否立即重载？');
        }
    }
}

async function handleConfigure() {
    const config = getConfig();
    const items = [
        {
            label: '$(clock) 频次时间窗口',
            description: '当前: ' + (config.window / 60000).toFixed(1) + ' 分钟',
            detail: '在此时间窗口内限制发送次数',
            key: 'window',
        },
        {
            label: '$(dashboard) 频次上限次数',
            description: '当前: ' + config.limit + ' 次',
            detail: '窗口内最多自动发送次数，超限后暂停',
            key: 'limit',
        },
        {
            label: '$(edit) 发送文本内容',
            description: '当前: "' + config.text + '"',
            detail: '检测到异常终止时自动发送的文本',
            key: 'text',
        },
    ];

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: '选择要修改的参数',
    });
    if (!picked) return;

    const targetCfg = vscode.workspace.getConfiguration('autoContinue');

    if (picked.key === 'window') {
        const input = await vscode.window.showInputBox({
            prompt: '频次时间窗口（毫秒）',
            value: String(config.window),
            validateInput: (v) => {
                const n = Number(v);
                if (!Number.isFinite(n) || n < 1000)
                    return '请输入不小于 1000 的毫秒数';
                return null;
            },
        });
        if (input !== undefined) {
            await targetCfg.update('windowMs', Number(input), vscode.ConfigurationTarget.Global);
        }
    } else if (picked.key === 'limit') {
        const input = await vscode.window.showInputBox({
            prompt: '窗口内最多发送次数',
            value: String(config.limit),
            validateInput: (v) => {
                const n = Number(v);
                if (!Number.isInteger(n) || n < 1) return '请输入不小于 1 的整数';
                return null;
            },
        });
        if (input !== undefined) {
            await targetCfg.update('limitCount', Number(input), vscode.ConfigurationTarget.Global);
        }
    } else if (picked.key === 'text') {
        const input = await vscode.window.showInputBox({
            prompt: '发送文本内容',
            value: config.text,
            validateInput: (v) => {
                if (!v || !v.trim()) return '文本不能为空';
                return null;
            },
        });
        if (input !== undefined) {
            await targetCfg.update('text', input.trim(), vscode.ConfigurationTarget.Global);
        }
    }

    // 配置变更后重新注入
    const newConfig = getConfig();
    if (newConfig.enabled) {
        await inject(newConfig);
    }
    await promptReload('[Auto Continue] 配置已更新，需要重载窗口才能生效。是否立即重载？');
}

async function handleResetLimit() {
    const config = getConfig();
    if (config.enabled) {
        await inject(config);
    }
    vscode.window.showInformationMessage('[Auto Continue] 频次计数将在下次续聊时重置');
}

// ---------- 入口 ----------

async function activate(context) {
    try {
        console.log('[Auto Continue] 插件已激活 v' + EXT_VERSION);

        // 1. 先创建状态栏（不管后续发生什么，状态栏必须出现）
        statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        statusBarItem.command = 'auto-continue.toggle';
        context.subscriptions.push(statusBarItem);

        // 2. 注册命令
        context.subscriptions.push(
            vscode.commands.registerCommand('auto-continue.toggle', () =>
                handleToggle(context)
            )
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('auto-continue.configure', handleConfigure)
        );
        context.subscriptions.push(
            vscode.commands.registerCommand('auto-continue.resetLimit', handleResetLimit)
        );

        // 3. 监听配置变更（但不在启动阶段触发重载提示）
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(async (e) => {
                if (e.affectsConfiguration('autoContinue')) {
                    const config = getConfig();
                    updateStatusBar(config.enabled);
                    if (config.enabled) {
                        await inject(config);
                    }
                }
            })
        );

        // 4. 读取配置并显示状态栏
        const config = getConfig();
        updateStatusBar(config.enabled);
        statusBarItem.show(); // ← 立即显示，不等待后续异步操作

        // 5. 检测是否需要注入（首次安装 / 版本升级 / 正常启动）
        const storedVersion = context.globalState.get('acVersion');
        const isFreshInstall = storedVersion === undefined;
        const isUpgrade = storedVersion !== undefined && storedVersion !== EXT_VERSION;

        if (isFreshInstall || isUpgrade) {
            // 安装或升级：强制执行注入，然后提示重载
            if (config.enabled) {
                const result = await inject(config);
                if (result !== 'error') {
                    await context.globalState.update('acEnabled', true);
                    await context.globalState.update('acVersion', EXT_VERSION);
                    const label = isFreshInstall ? '首次安装' : '已升级到 v' + EXT_VERSION;
                    await promptReload(
                        '[Auto Continue] ' + label + '，需要重载窗口才能生效。是否立即重载？'
                    );
                }
            } else {
                // 安装了但默认关闭，也记录版本
                await context.globalState.update('acVersion', EXT_VERSION);
            }
        } else {
            // 非安装/升级：正常启动，确认注入状态与配置一致
            const storedEnabled = context.globalState.get('acEnabled');
            if (config.enabled && storedEnabled !== false) {
                const result = await inject(config);
                if (result === 'injected') {
                    // 之前有配置但 workbench.html 丢了标记（可能被重置），补注入并提示
                    await promptReload(
                        '[Auto Continue] 检测到脚本标记丢失，已重新注入。需要重载窗口才能生效，是否立即重载？'
                    );
                }
                // result === 'updated' 是正常情况，静默
            }
        }
    } catch (err) {
        console.error('[Auto Continue] 激活过程出错:', err);
        // 状态栏已经显示了，用户至少能看到开关
    }
}

function deactivate() {
    console.log('[Auto Continue] 插件已停用');
}

module.exports = { activate, deactivate };
