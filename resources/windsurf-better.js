/**
 * Windsurf Better v1.0.0
 * 整合版：回复建议提示 + 汉化
 */
(function () {
	'use strict';
	const VERSION = '1.4.1';
	const LOG_PREFIX = '[WS-Better]';

	// ========== Trusted Types 兼容（Windsurf 新版启用了 require-trusted-types-for 'script'） ==========
	// CSP 里已由扩展的 enhancementInjector.ts 注入 'abBubbles' policy 名
	const _ttPolicy = (() => {
		try {
			if (typeof trustedTypes !== 'undefined' && trustedTypes.createPolicy) {
				return trustedTypes.createPolicy('abBubbles', {
					createHTML: (s) => s,
					createScript: (s) => s,
					createScriptURL: (s) => s,
				});
			}
		} catch (e) { console.warn(LOG_PREFIX + ' TT policy 创建失败:', e); }
		return null;
	})();
	function clearEl(el) {
		try { el.replaceChildren(); }
		catch { try { el.textContent = ''; } catch {} }
	}
	function setSafeHTML(el, html) {
		try {
			el.innerHTML = _ttPolicy ? _ttPolicy.createHTML(html) : html;
		} catch (e) {
			// Trusted Types 拒绝时退化：解析为 DOM 后追加
			try {
				clearEl(el);
				const tpl = document.createElement('template');
				tpl.innerHTML = _ttPolicy ? _ttPolicy.createHTML(html) : html;
				el.appendChild(tpl.content);
			} catch {
				try { el.textContent = String(html).replace(/<[^>]+>/g, ''); } catch {}
			}
		}
	}

	// ========== 统一配置 ==========
	const DEFAULT_SETTINGS = {
		// 回复建议提示设置
		bubblesEnabled: true,
		bubblesAutoSend: true,
		bubblesTheme: 'emerald',
		bubblesShape: 'rounded',
		// 汉化设置
		localizationEnabled: true,
		// 自动操作
		continueMode: 'smart',  // 'smart' | 'brainless' | 'off'
		continueText: 'continue',  // 自动发送的文本（两种模式共享）
		dismissCorruptEnabled: true,
		autoSwitchEnabled: true,
		autoSwitchOnQuota: true,
		autoSwitchOnRateLimit: true,
		// 无脑模式参数
		brainlessModeEnabled: false,  // 兼容旧设置
		brainlessIdleSeconds: 8,
		brainlessMaxConsecutive: 0,  // 0 = 无限
		brainlessSkipPermission: true,
		// 自动恢复
		autoRecoveryEnabled: true,
		autoApproveWebRequests: false,
		continueAfterSwitch: true,  // 切号后自动发送"继续"而非重发原消息
		recoveryMaxRetries: 3,
		recoveryBaseDelay: 5000,
		// 交互式恢复确认 banner（v6.6.0 新增）
		recoveryConfirmEnabled: true,        // 总开关：所有自动恢复操作都先弹 banner 倒计时
		recoveryCountdownSeconds: 5,         // 倒计时秒数（3-15）
		// 分类恢复规则
		recoveryRules: {
			networkErrors:      { action: 'retry', maxRetries: 3, delay: 3000 },
			quotaErrors:        { action: 'switch-account', afterAction: 'auto' },
			// modelErrors 默认从 switch-model 改为 send-continue：
			// 实测"模型提供商不可达"等第三方故障是临时性的，等几秒发继续就能恢复，
			// 切模型反而因 modelPriority 名字对不上而陷入冷却死锁
			modelErrors:        { action: 'send-continue', afterAction: 'auto', modelPriority: [] },
			continuationErrors: { action: 'send-continue' },
			permissionRequests: { action: 'auto-allow', scope: ['web-request', 'terminal', 'file-write'] },
			userIntervention:   { action: 'notify' },
		},
		customRecoveryRules: [],  // [{name, pattern, action, ...}]
		// 完成提醒
		notifyEnabled: true,
		notifyTrigger: 'always',    // always | error | idle
		notifySound: true,
		notifyDesktop: true,
		notifyTone: 'funk',         // funk | ding | chime | beep
		notifyRepeat: 2,            // 1-5
	};
	const STORAGE_KEY = 'ws-better-settings';
	
	function loadSettings() {
		// 优先级：扩展宿主嵌入的设置 > localStorage > 默认值
		// 嵌入值是真相源（侧栏改设置后扩展会重写 workbench.html）
		const injected = (typeof window !== 'undefined' && window.__WS_BETTER_INJECTED_SETTINGS__) || null;
		try {
			const r = localStorage.getItem(STORAGE_KEY);
			const local = r ? JSON.parse(r) : {};
			const merged = { ...DEFAULT_SETTINGS, ...local, ...(injected || {}) };
			// 迁移旧设置：autoContinueEnabled / brainlessModeEnabled → continueMode
			if (!merged.continueMode || merged.continueMode === 'smart') {
				if (merged.brainlessModeEnabled) merged.continueMode = 'brainless';
				else if (merged.autoContinueEnabled === false) merged.continueMode = 'off';
				else merged.continueMode = 'smart';
			}
			return merged;
		} catch {
			return { ...DEFAULT_SETTINGS, ...(injected || {}) };
		}
	}
	
	function saveSettings(s) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
		} catch {}
	}
	
	let settings = loadSettings();
	// 启动时把合并后的真相同步回 localStorage，保证 windsurf-better.js 自己的设置面板
	// 在不重启的情况下也能反映侧栏改动
	saveSettings(settings);
	
	// ========== 回复建议提示功能 ==========
	const CHAT_ROOT_SELECTOR = '.chat-client-root';
	const INPUT_CANDIDATES = [
		'div[contenteditable="true"][data-lexical-editor="true"]',
		'div[contenteditable="true"][role="textbox"]',
		'div[contenteditable="true"]',
		'textarea',
	];
	const SEND_BTN_CANDIDATES = [
		'button[data-tooltip-id*="send"]',
		'button[aria-label*="Send"]',
		'button[aria-label*="send"]',
		'button.send-button',
	];
	
	const BUBBLE_THEMES = [
		{ id:'emerald',name:'绿青蓝（翡翠）',bg:'linear-gradient(135deg,#22c55e,#06b6d4,#3b82f6)',bgHover:'linear-gradient(135deg,#16a34a,#0891b2,#2563eb)',color:'#fff',shadow:'0 2px 8px rgba(34,197,94,.2)',border:'none',letterBg:'rgba(255,255,255,.2)',letterColor:'#fff',tagBg:'linear-gradient(135deg,#22c55e,#06b6d4,#3b82f6)'},
		{ id:'aurora',name:'紫粉（极光）',bg:'linear-gradient(135deg,#a855f7,#ec4899)',bgHover:'linear-gradient(135deg,#9333ea,#db2777)',color:'#fff',shadow:'0 2px 8px rgba(168,85,247,.2)',border:'none',letterBg:'rgba(255,255,255,.2)',letterColor:'#fff',tagBg:'linear-gradient(135deg,#a855f7,#ec4899)'},
		{ id:'sunset',name:'橙红（日落）',bg:'linear-gradient(135deg,#f59e0b,#ef4444)',bgHover:'linear-gradient(135deg,#d97706,#dc2626)',color:'#fff',shadow:'0 2px 8px rgba(245,158,11,.2)',border:'none',letterBg:'rgba(255,255,255,.2)',letterColor:'#fff',tagBg:'linear-gradient(135deg,#f59e0b,#ef4444)'},
		{ id:'ocean',name:'深蓝（海洋）',bg:'#1e40af',bgHover:'#1e3a8a',color:'#fff',shadow:'0 2px 8px rgba(30,64,175,.25)',border:'none',letterBg:'rgba(255,255,255,.15)',letterColor:'#fff',tagBg:'#1e40af'},
		{ id:'glass',name:'透明（毛玻璃）',bg:'rgba(255,255,255,.08)',bgHover:'rgba(255,255,255,.14)',color:'rgba(255,255,255,.8)',shadow:'0 2px 8px rgba(0,0,0,.1)',border:'1px solid rgba(255,255,255,.12)',letterBg:'rgba(255,255,255,.1)',letterColor:'rgba(255,255,255,.6)',tagBg:'rgba(167,139,250,.3)',blur:true},
		{ id:'dark',name:'暗夜',bg:'#1f2937',bgHover:'#111827',color:'#e5e7eb',shadow:'0 2px 8px rgba(0,0,0,.3)',border:'1px solid rgba(255,255,255,.08)',letterBg:'rgba(255,255,255,.1)',letterColor:'#9ca3af',tagBg:'#374151'},
	];
	const BUBBLE_SHAPES = [{id:'pill',radius:'20px'},{id:'rounded',radius:'10px'},{id:'soft',radius:'6px'},{id:'sharp',radius:'2px'}];
	const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const ICON_BUBBLES = 'M20,2H4C2.9,2,2,2.9,2,4v18l4-4h14c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2z M6,14v-2h8v2H6z M14,11H6V9h8V11z M18,8H6V6h12V8z';
	
	function injectBubblesStyles() {
		// 幂等：已存在则复用同一 <style> 元素更新内容（避免重复创建）
		let style = document.getElementById('ws-bubbles-css');
		if (!style) {
			style = document.createElement('style');
			style.id = 'ws-bubbles-css';
			(document.head || document.documentElement).appendChild(style);
		}
		style.textContent = `
.ws-bubbles{margin:16px 0 12px;padding:0;background:none;border:none;border-radius:0;animation:wsBubbleFadeIn .35s ease}
@keyframes wsBubbleFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.ws-bubbles-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.ws-bubbles-title{font-size:13px;font-weight:600;color:#0ea5e9!important;display:flex;align-items:center;gap:6px}
.ws-bubbles-title svg{width:14px;height:14px;fill:#0ea5e9}
.ws-bubbles-question{font-size:13px;color:#0ea5e9!important;font-weight:500;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}
.ws-bubbles-mode-tag{font-size:10px;color:#fff;background:linear-gradient(135deg,#22c55e,#06b6d4,#3b82f6);padding:2px 8px;border-radius:10px;margin-left:8px}
.ws-bubble-option{display:flex!important;align-items:center!important;gap:12px!important;padding:10px 14px!important;margin-bottom:6px!important;border-radius:10px!important;cursor:pointer!important;transition:all .2s ease!important;background:linear-gradient(135deg,#22c55e,#06b6d4,#3b82f6)!important;border:none!important;box-shadow:0 2px 8px rgba(34,197,94,.2)}
.ws-bubble-option:hover{background:linear-gradient(135deg,#16a34a,#0891b2,#2563eb)!important;box-shadow:0 4px 12px rgba(34,197,94,.3);transform:translateX(3px)}
.ws-bubble-option-letter{width:26px;height:26px;border-radius:8px;background:rgba(255,255,255,.2);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0}
.ws-bubble-option-text{font-size:13px!important;color:#fff!important;font-weight:500!important;flex:1}
.ws-bubbles-chips{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.ws-bubble-chip{display:inline-flex!important;align-items:center!important;gap:6px!important;padding:8px 16px!important;border-radius:10px!important;cursor:pointer!important;font-size:13px!important;font-weight:500!important;font-family:inherit!important;color:#fff!important;background:linear-gradient(135deg,#22c55e,#06b6d4,#3b82f6)!important;border:none!important;transition:all .2s ease!important;box-shadow:0 2px 8px rgba(34,197,94,.2)}
.ws-bubble-chip::before{content:'\\2726';font-size:8px;color:rgba(255,255,255,.8);flex-shrink:0}
.ws-bubble-chip:hover{background:linear-gradient(135deg,#16a34a,#0891b2,#2563eb)!important;color:#fff!important;transform:translateY(-1px);box-shadow:0 4px 12px rgba(34,197,94,.3)}
.ws-bubble-related{display:flex!important;align-items:center!important;padding:11px 14px!important;margin-bottom:6px!important;border-radius:10px!important;cursor:pointer!important;font-size:13px!important;font-weight:500!important;font-family:inherit!important;color:#fff!important;background:linear-gradient(135deg,#ca8a04,#22c55e,#06b6d4,#3b82f6)!important;border:none!important;transition:all .2s ease!important;text-align:left!important;width:100%!important;box-shadow:0 2px 8px rgba(34,197,94,.2)}
.ws-bubble-related::before{content:'\\2192';margin-right:10px;color:rgba(255,255,255,.8);font-weight:700;font-size:14px}
.ws-bubble-related:hover{background:linear-gradient(135deg,#ca8a04,#16a34a,#0891b2,#2563eb)!important;box-shadow:0 4px 12px rgba(34,197,94,.3);transform:translateX(3px)}
.ws-bubble-custom-input{flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#e5e7eb;font-size:13px;outline:none}
.ws-bubble-custom-input:focus{border-color:rgba(59,130,246,.5)}
.ws-bubble-custom-send{padding:5px 12px;border-radius:6px;border:none;background:linear-gradient(135deg,#7c3aed,#667eea);color:#fff;font-size:12px;cursor:pointer;font-family:inherit}
.ws-bubble-custom-send:hover{filter:brightness(1.15)}
`;
	}
	
	function logBubbles(...args) { console.log(LOG_PREFIX + '[Bubbles]', ...args); }
	
	function findChatRoot() {
		let root = document.querySelector(CHAT_ROOT_SELECTOR);
		if (root) return root;
		try {
			for (const f of document.querySelectorAll('iframe')) {
				try {
					const d = f.contentDocument;
					if (d) {
						root = d.querySelector(CHAT_ROOT_SELECTOR);
						if (root) return root;
					}
				} catch {}
			}
		} catch {}
		return null;
	}
	
	let _cachedInput = null;
	function findInputEl() {
		if (_cachedInput && _cachedInput.isConnected && _cachedInput.getBoundingClientRect().width > 0) return _cachedInput;
		const scopes = [findChatRoot(), document].filter(Boolean);
		for (const scope of scopes) {
			for (const sel of INPUT_CANDIDATES) {
				const el = scope.querySelector(sel);
				if (el) { _cachedInput = el; return el; }
			}
		}
		for (const el of document.querySelectorAll('[contenteditable="true"]')) {
			const r = el.getBoundingClientRect();
			if (r.width > 100 && r.bottom > window.innerHeight * 0.5) { _cachedInput = el; return el; }
		}
		for (const ta of document.querySelectorAll('textarea')) {
			const r = ta.getBoundingClientRect();
			if (r.width > 100 && r.height > 20) { _cachedInput = ta; return ta; }
		}
		return null;
	}
	
	async function setInputText(text) {
		const inputEl = findInputEl();
		if (!inputEl) { console.log(LOG_PREFIX, '[setInputText] 找不到输入框'); return false; }
		console.log(LOG_PREFIX, '[setInputText] 找到输入框:', inputEl.tagName, 'lexical:', inputEl.getAttribute('data-lexical-editor'), 'ce:', inputEl.contentEditable);
		inputEl.focus();

		if (inputEl.getAttribute('data-lexical-editor') === 'true' || inputEl.contentEditable === 'true') {
			// 探测 Lexical editor 实例
			const lexKeys = Object.keys(inputEl).filter(k => k.startsWith('__'));
			console.log(LOG_PREFIX, '[setInputText] DOM 内部属性:', lexKeys);

			// === 方法A: 通过 Lexical editor 实例直接 dispatch 命令 ===
			try {
				const editorKey = Object.keys(inputEl).find(k => k.startsWith('__lexicalEditor'));
				const editor = editorKey ? inputEl[editorKey] : null;
				if (editor && typeof editor.update === 'function') {
					console.log(LOG_PREFIX, '[setInputText] ✅ 找到 Lexical editor 实例, 方法:', Object.keys(editor).filter(k => typeof editor[k] === 'function').join(','));
					// 使用 editor.update() 清空并插入文本
					await new Promise((resolve, reject) => {
						try {
							editor.update(() => {
								try {
									// 获取 root node
									const editorState = editor.getEditorState();
									const root = editorState._nodeMap.get('root');
									console.log(LOG_PREFIX, '[setInputText] root node:', root ? root.__type : 'null');
									// 清空所有子节点
									if (root && root.clear) root.clear();
									// 利用 Lexical 的内部方法创建段落和文本
									// 通过 editor._nodes 查找 ParagraphNode 和 TextNode 的类
									const nodeTypes = editor._nodes;
									console.log(LOG_PREFIX, '[setInputText] 注册的节点类型:', nodeTypes ? Array.from(nodeTypes.keys()) : 'null');
									let ParagraphKlass = null, TextKlass = null;
									if (nodeTypes) {
										for (const [type, entry] of nodeTypes) {
											const klass = entry.klass || entry;
											if (type === 'paragraph' && klass) ParagraphKlass = klass;
											if (type === 'text' && klass) TextKlass = klass;
										}
									}
									if (ParagraphKlass && TextKlass) {
										const p = new ParagraphKlass();
										const t = new TextKlass(text);
										p.append(t);
										root.append(p);
										console.log(LOG_PREFIX, '[setInputText] ✅ Lexical API 插入成功');
									} else {
										console.log(LOG_PREFIX, '[setInputText] 未找到 Paragraph/Text 节点类, P:', !!ParagraphKlass, 'T:', !!TextKlass);
									}
								} catch (innerErr) {
									console.error(LOG_PREFIX, '[setInputText] update 内部错误:', innerErr);
								}
							}, { onUpdate: () => resolve(true) });
						} catch (e) { reject(e); }
					});
					await new Promise(r => setTimeout(r, 50));
					if ((inputEl.textContent || '').trim().length > 0) {
						console.log(LOG_PREFIX, '[setInputText] Lexical API 写入后 textContent:', inputEl.textContent);
						return true;
					}
				} else {
					console.log(LOG_PREFIX, '[setInputText] 未找到 Lexical editor 实例 (key:', editorKey, ')');
				}
			} catch (e) {
				console.warn(LOG_PREFIX, '[setInputText] Lexical API 方案异常:', e);
			}

			// === 方法B: execCommand insertText (fallback) ===
			try {
				const sel = window.getSelection();
				const range = document.createRange();
				range.selectNodeContents(inputEl);
				sel.removeAllRanges(); sel.addRange(range);
				const ok = document.execCommand('insertText', false, text);
				console.log(LOG_PREFIX, '[setInputText] execCommand insertText 返回:', ok, 'textContent:', inputEl.textContent);
				await new Promise(r => setTimeout(r, 50));
				if (ok && (inputEl.textContent || '').trim().length > 0) {
					return true;
				}
			} catch (e) {
				console.warn(LOG_PREFIX, '[setInputText] execCommand 异常:', e);
			}

			console.log(LOG_PREFIX, '[setInputText] 所有方法均失败');
			return false;
		}

		// textarea / input
		if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
			const ns = Object.getOwnPropertyDescriptor(inputEl.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
			if (ns) ns.call(inputEl, text); else inputEl.value = text;
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));
			inputEl.dispatchEvent(new Event('change', { bubbles: true }));
			logBubbles('已写入(textarea)');
			return true;
		}

		// 最终兜底
		clearEl(inputEl);
		text.split('\n').forEach(line => {
			const p = document.createElement('p');
			p.textContent = line || '\u200B';
			inputEl.appendChild(p);
		});
		inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		logBubbles('已写入(fallback)');
		return true;
	}
	
	// v6.6.1+v6.6.2 审查修订：派发完整的 Enter 键序列（keydown/keypress/keyup）
	// Lexical / contentEditable 不同框架监听不同事件，全派发覆盖最广
	// 审查改进：保存并恢复原 focus 元素，避免在多输入框场景下夺走用户焦点
	function dispatchEnterKey(inputEl) {
		if (!inputEl) return false;
		const prevFocus = document.activeElement;
		const needsFocusRestore = prevFocus && prevFocus !== inputEl && typeof prevFocus.focus === 'function';
		inputEl.focus();
		const eventInit = {
			key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
			bubbles: true, cancelable: true, composed: true
		};
		for (const eventType of ['keydown', 'keypress', 'keyup']) {
			try {
				inputEl.dispatchEvent(new KeyboardEvent(eventType, eventInit));
			} catch {}
		}
		// 若原本焦点不在 inputEl 上，恢复（异步以免打断 Enter 后续处理）
		if (needsFocusRestore) {
			setTimeout(() => { try { prevFocus.focus(); } catch {} }, 0);
		}
		return true;
	}

	// 统一发送策略：标准按钮 → 最右边按钮 → Enter键
	// v6.6.1：queued 状态下优先走 Enter（按钮策略在配额耗尽/queued 时不可靠）
	function trySendMessage() {
		const inputEl = findInputEl();
		if (!inputEl) return null;

		// v6.6.1 关键修复：检测到 queued 状态时，直接走 Enter 键
		// 原因：配额耗尽 + queued 状态下，发送按钮被禁用或替换，
		// 「最右边按钮」策略可能误点到「全部接受/拒绝」权限按钮。
		// Windsurf 自己的提示就是「按回车发送排队消息 (⏎)」，Enter 是官方推荐路径。
		if (hasQueuedMessage()) {
			dispatchEnterKey(inputEl);
			console.log(LOG_PREFIX, '[trySend] ✅ queued 状态 → Enter 键（绕过按钮策略）');
			return 'enter-queued';
		}

		// 策略1: 标准选择器找发送按钮
		const sendBtn = findSendBtnAdvanced();
		if (sendBtn && !sendBtn.disabled) {
			sendBtn.click();
			console.log(LOG_PREFIX, '[trySend] ✅ 策略1: 标准选择器');
			return 'button';
		}

		// 策略2: 输入区域最右边的按钮（Windsurf 的发送按钮 ⬆ 固定在工具栏最右边）
		const inputRect = inputEl.getBoundingClientRect();
		let rightmostBtn = null, rightmostX = -Infinity;
		let c = inputEl.parentElement;
		for (let d = 0; d < 6 && c; d++) {
			const btns = c.querySelectorAll('button');
			for (const btn of btns) {
				if (btn.disabled) continue;
				const r = btn.getBoundingClientRect();
				if (r.width === 0 || r.height === 0) continue;
				// v6.6.1+v6.6.2 审查修订：精确排除「全部接受/全部拒绝」批量权限按钮
				// 截图证实 queued+配额耗尽场景下这些按钮会出现在输入区附近
				// 注意：用精确文本匹配（^...$），避免误伤 "Accept changes" / "Accept suggestion" 等
				const txt = (btn.textContent || '').trim();
				if (/^(全部接受|全部拒绝|accept all|reject all)$/i.test(txt)) continue;
				// 只考虑和输入框垂直方向接近的按钮（同一工具栏区域）
				if (Math.abs(r.top - inputRect.bottom) < 60 || Math.abs(r.bottom - inputRect.bottom) < 60) {
					if (r.right > rightmostX) {
						rightmostX = r.right;
						rightmostBtn = btn;
					}
				}
			}
			if (rightmostBtn) break;
			c = c.parentElement;
		}
		if (rightmostBtn) {
			rightmostBtn.click();
			console.log(LOG_PREFIX, '[trySend] ✅ 策略2: 最右边按钮, x:', Math.round(rightmostX));
			return 'rightmost';
		}

		// 策略3: Enter 键（Lexical state 通过原生 API 同步后 Enter 应触发提交）
		dispatchEnterKey(inputEl);
		console.log(LOG_PREFIX, '[trySend] ✅ 策略3: Enter键');
		return 'enter';
	}

	function findSendBtnAdvanced() {
		const root = findChatRoot();
		const scope = root || document;
		console.log(LOG_PREFIX, '[findSendBtn] chatRoot:', root ? root.tagName + '.' + root.className.substring(0, 40) : 'null', '→ scope:', scope === document ? 'document' : 'element');
		for (const sel of SEND_BTN_CANDIDATES) {
			const el = scope.querySelector(sel);
			if (el) { console.log(LOG_PREFIX, '[findSendBtn] 命中选择器:', sel); return el; }
		}
		const btns = scope.querySelectorAll('button');
		for (const btn of btns) {
			const a = (btn.getAttribute('aria-label') || '').toLowerCase();
			const t = (btn.getAttribute('title') || '').toLowerCase();
			const tt = (btn.getAttribute('data-tooltip-id') || '').toLowerCase();
			if (a.includes('send') || t.includes('send') || tt.includes('send') || a.includes('submit') || t.includes('submit')) return btn;
		}
		const inputEl = findInputEl();
		if (inputEl) {
			let container = inputEl.parentElement;
			for (let i = 0; i < 5 && container; i++) {
				const btnsNear = container.querySelectorAll('button');
				for (const btn of btnsNear) {
					const svg = btn.querySelector('svg');
					if (svg && !btn.disabled) {
						const paths = svg.querySelectorAll('path');
						if (paths.length <= 3) { logBubbles('找到输入框附近SVG按钮'); return btn; }
					}
				}
				container = container.parentElement;
			}
		}
		return null;
	}
	
	function submitBubbleText(text) {
		if (!text) return;
		setInputText(text).then(ok => {
			if (!ok || !settings.bubblesAutoSend) return;
			setTimeout(() => trySendMessage(), 400);
		});
	}
	
	function renderBubblesCard(data, container) {
		const wrapper = document.createElement('div');
		wrapper.className = 'ws-bubbles';
		wrapper.dataset.wsBubblesRendered = '1';
		wrapper.style.cssText = 'pointer-events:all!important;position:relative;z-index:10;';
		
		if (data.title || data.type === 'clarify') {
			const header = document.createElement('div');
			header.className = 'ws-bubbles-header';
			const titleEl = document.createElement('div');
			titleEl.className = 'ws-bubbles-title';
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('viewBox', '0 0 24 24');
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', ICON_BUBBLES);
			path.setAttribute('fill', 'currentColor');
			svg.appendChild(path);
			titleEl.appendChild(svg);
			titleEl.appendChild(document.createTextNode(data.title || 'Suggestions'));
			header.appendChild(titleEl);
			wrapper.appendChild(header);
		}
		
		if (data.type === 'clarify' && data.question) {
			const qEl = document.createElement('div');
			qEl.className = 'ws-bubbles-question';
			qEl.appendChild(document.createTextNode(data.question));
			const tag = document.createElement('span');
			tag.className = 'ws-bubbles-mode-tag';
			tag.textContent = data.mode === 'multi' ? 'Multi' : 'Single';
			qEl.appendChild(tag);
			wrapper.appendChild(qEl);
		}
		
		if (data.type === 'clarify') {
			data.items.forEach((item, i) => {
				const opt = document.createElement('div');
				opt.className = 'ws-bubble-option';
				const letter = document.createElement('span');
				letter.className = 'ws-bubble-option-letter';
				letter.textContent = LETTERS[i] || String(i + 1);
				const text = document.createElement('span');
				text.className = 'ws-bubble-option-text';
				text.textContent = item;
				opt.appendChild(letter);
				opt.appendChild(text);
				opt.style.pointerEvents = 'all';
				opt.addEventListener('click', e => {
					e.stopPropagation(); e.stopImmediatePropagation();
					submitBubbleText(LETTERS[i] + '. ' + item);
					wrapper.remove();
				});
				opt.addEventListener('mousedown', e => e.stopPropagation());
				wrapper.appendChild(opt);
			});
			const co = document.createElement('div');
			co.className = 'ws-bubble-option';
			const cl = document.createElement('span');
			cl.className = 'ws-bubble-option-letter';
			cl.textContent = '\u270F';
			cl.style.fontSize = '13px';
			const ct = document.createElement('span');
			ct.className = 'ws-bubble-option-text';
			ct.textContent = 'Custom answer...';
			ct.style.opacity = '0.5';
			ct.style.fontStyle = 'italic';
			co.appendChild(cl);
			co.appendChild(ct);
			const cir = document.createElement('div');
			cir.style.cssText = 'display:none;gap:6px;align-items:center;margin-top:6px;';
			const ci = document.createElement('input');
			ci.type = 'text';
			ci.className = 'ws-bubble-custom-input';
			ci.placeholder = 'Type your answer...';
			ci.style.flex = '1';
			const csb = document.createElement('button');
			csb.className = 'ws-bubble-custom-send';
			csb.textContent = 'Send';
			csb.addEventListener('click', () => {
				const v = ci.value.trim();
				if (v) { submitBubbleText(v); wrapper.remove(); }
			});
			ci.addEventListener('keydown', e => { if (e.key === 'Enter') csb.click(); });
			cir.appendChild(ci);
			cir.appendChild(csb);
			co.addEventListener('click', e => {
				if (e.target === ci || e.target === csb) return;
				cir.style.display = cir.style.display === 'none' ? 'flex' : 'none';
				if (cir.style.display === 'flex') setTimeout(() => ci.focus(), 50);
			});
			wrapper.appendChild(co);
			wrapper.appendChild(cir);
		} else if (data.type === 'suggest') {
			const chips = document.createElement('div');
			chips.className = 'ws-bubbles-chips';
			data.items.forEach(item => {
				const chip = document.createElement('button');
				chip.className = 'ws-bubble-chip';
				chip.style.pointerEvents = 'all';
				chip.textContent = item;
				chip.addEventListener('click', e => {
					e.stopPropagation(); e.stopImmediatePropagation();
					submitBubbleText(item);
					wrapper.remove();
				});
				chip.addEventListener('mousedown', e => e.stopPropagation());
				chips.appendChild(chip);
			});
			wrapper.appendChild(chips);
		} else {
			data.items.forEach(item => {
				const b = document.createElement('button');
				b.className = 'ws-bubble-related';
				b.style.pointerEvents = 'all';
				b.textContent = item;
				b.addEventListener('click', e => {
					e.stopPropagation(); e.stopImmediatePropagation();
					submitBubbleText(item);
					wrapper.remove();
				});
				b.addEventListener('mousedown', e => e.stopPropagation());
				wrapper.appendChild(b);
			});
		}
		
		container.appendChild(wrapper);
		applyBubbleStyle(wrapper);
	}

	/**
	 * 对单个 bubble wrapper 应用当前 settings 中的主题/形状
	 * 抽离后可在主题/形状切换时对所有现存 .ws-bubbles 容器重新调用，实现实时换肤
	 */
	function applyBubbleStyle(wrapper) {
		if (!wrapper) return;
		const themeId = settings.bubblesTheme || 'emerald';
		const theme = BUBBLE_THEMES.find(t => t.id === themeId);
		const S = (el, p, v) => el.style.setProperty(p, v, 'important');

		// 主题：emerald 走 CSS 默认值（清掉 inline override）；其他主题用 inline style 覆盖
		const isDefault = themeId === 'emerald';
		wrapper.querySelectorAll('.ws-bubble-option,.ws-bubble-chip,.ws-bubble-related').forEach(btn => {
			if (isDefault || !theme) {
				// 清掉 inline override，让 CSS 默认生效
				['background', 'color', 'box-shadow', 'border', 'backdrop-filter'].forEach(p => btn.style.removeProperty(p));
				return;
			}
			S(btn, 'background', theme.bg);
			S(btn, 'color', theme.color);
			S(btn, 'box-shadow', theme.shadow);
			if (theme.border && theme.border !== 'none') S(btn, 'border', theme.border); else S(btn, 'border', 'none');
			if (theme.blur) btn.style.backdropFilter = 'blur(12px)'; else btn.style.removeProperty('backdrop-filter');
			// hover 行为：用 dataset 标记避免重复绑定
			if (!btn.dataset.wsThemeBound) {
				btn.dataset.wsThemeBound = '1';
				btn.addEventListener('mouseenter', () => {
					const t = BUBBLE_THEMES.find(x => x.id === (settings.bubblesTheme || 'emerald'));
					if (t && (settings.bubblesTheme || 'emerald') !== 'emerald') S(btn, 'background', t.bgHover);
				});
				btn.addEventListener('mouseleave', () => {
					const t = BUBBLE_THEMES.find(x => x.id === (settings.bubblesTheme || 'emerald'));
					if (t && (settings.bubblesTheme || 'emerald') !== 'emerald') S(btn, 'background', t.bg);
				});
			}
		});
		wrapper.querySelectorAll('.ws-bubble-option-letter').forEach(el => {
			if (isDefault || !theme) {
				['background', 'color'].forEach(p => el.style.removeProperty(p));
				return;
			}
			S(el, 'background', theme.letterBg);
			S(el, 'color', theme.letterColor);
		});
		wrapper.querySelectorAll('.ws-bubble-option-text').forEach(el => {
			if (isDefault || !theme) el.style.removeProperty('color');
			else S(el, 'color', theme.color);
		});
		wrapper.querySelectorAll('.ws-bubbles-mode-tag').forEach(el => {
			if (isDefault || !theme) el.style.removeProperty('background');
			else S(el, 'background', theme.tagBg || theme.bg);
		});

		// 形状
		const shapeId = settings.bubblesShape || 'rounded';
		const shape = BUBBLE_SHAPES.find(s => s.id === shapeId);
		if (shape) {
			wrapper.querySelectorAll('.ws-bubble-option,.ws-bubble-chip,.ws-bubble-related').forEach(btn => {
				btn.style.setProperty('border-radius', shape.radius, 'important');
			});
			wrapper.querySelectorAll('.ws-bubble-option-letter').forEach(el => {
				const lr = Math.max(2, parseInt(shape.radius) - 2) + 'px';
				el.style.setProperty('border-radius', lr, 'important');
			});
		}
	}

	/** 对所有现存 .ws-bubbles 容器重新应用当前主题/形状（实时换肤用） */
	function restyleAllBubbles() {
		document.querySelectorAll('.ws-bubbles').forEach(applyBubbleStyle);
	}
	
	function parseBubbleMetaFromText(text, data) {
		const tm = text.match(/\btype:\s*(clarify|suggest|related)/);
		if (tm) data.type = tm[1];
		const ti = text.match(/\btitle:\s*(.+?)(?:\s+(?:type|question|mode|items):|$)/);
		if (ti) data.title = ti[1].trim();
		const qm = text.match(/\bquestion:\s*(.+?)(?:\s+(?:type|title|mode|items):|$)/);
		if (qm) data.question = qm[1].trim();
		const mm = text.match(/\bmode:\s*(single|multi)/);
		if (mm) data.mode = mm[1];
	}
	
	// 判断文本节点是否处于"不应渲染气泡"的容器中：代码块、输入框、可编辑区
	// 这样代码块里贴 :::bubbles 示例 / 输入框预览，不会被解析吃掉
	function isInExcludedBubbleZone(node) {
		let p = node && (node.nodeType === 1 ? node : node.parentElement);
		while (p) {
			const tag = p.tagName;
			if (tag === 'PRE' || tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' ||
			    tag === 'TEXTAREA' || tag === 'INPUT') return true;
			if (p.isContentEditable) return true;
			// 兼容常见 markdown / chat 输入框样式类
			const cls = p.className;
			if (typeof cls === 'string' && cls && (
				/\b(code-block|markdown-code-block|hljs|monaco-editor|input-area|chat-input|composer|editor-host)\b/.test(cls)
			)) return true;
			p = p.parentElement;
		}
		return false;
	}

	function findClosingMarker(openNode, openOffset, scope) {
		const sameNodeText = openNode.textContent.substring(openOffset + 10);
		const sameMatch = sameNodeText.match(/:{3}(?!bubbles)/);
		if (sameMatch) {
			return { node: openNode, offset: openOffset + 10 + sameMatch.index + 3 };
		}
		const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
		w.currentNode = openNode;
		let next;
		while (next = w.nextNode()) {
			// 跳过代码块/输入框中的 ::: ，避免跨容器吞内容
			if (isInExcludedBubbleZone(next)) continue;
			const t = next.textContent || '';
			const m = t.match(/:{3}(?!bubbles)/);
			if (m) return { node: next, offset: m.index + 3 };
		}
		return null;
	}
	
	function extractItemsInRange(range) {
		const items = [];
		const ancestor = range.commonAncestorContainer;
		const root = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;
		if (!root) return items;
		
		const lis = root.querySelectorAll('li, [role="listitem"]');
		const nodeRange = document.createRange();
		lis.forEach(li => {
			try {
				nodeRange.selectNode(li);
				if (range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0 &&
				    range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0) {
					let t = (li.textContent || '').trim();
					t = t.replace(/\s*:{3}\s*$/, '');
					if (t) items.push(t);
				}
			} catch (e) {}
		});
		
		if (items.length === 0) {
			const txt = range.toString();
			const lines = txt.split(/\r?\n/);
			const bulletRe = /^\s*[-*•·]\s*(\S.*)$/;
			lines.forEach(line => {
				const m = line.match(bulletRe);
				if (m) {
					let t = m[1].trim().replace(/\s*:{3}\s*$/, '');
					if (t) items.push(t);
				}
			});
		}
		
		if (items.length === 0) {
			// 兜底：构造净化后的载荷字符串，再按行解析
			let txt = range.toString();
			// 去掉首部 :::bubbles 标记
			txt = txt.replace(/^\s*:{3}bubbles\b/i, '');
			// 去掉尾部 ::: 标记
			txt = txt.replace(/:{3}\s*$/, '');

			// 定位 items: 关键字（任意位置，不限行首）
			const itemsMatch = txt.match(/\bitems\s*:/i);
			let payload;
			if (itemsMatch) {
				payload = txt.substring(itemsMatch.index + itemsMatch[0].length);
			} else {
				// 无 items: 关键字时，剥离已知元数据键值
				payload = txt.replace(/\b(type|title|question|mode)\s*:\s*[^\n]*?(?=\s+\b(type|title|question|mode|items)\s*:|\n|$)/gi, '');
			}

			const metaRe = /^(type|title|question|mode|items)\s*:/i;
			const lines = payload.split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
			for (const line of lines) {
				let t = line.replace(/^[-*•·+]\s*/, '');
				t = t.replace(/\s*:{3}\s*$/, '');
				if (!t || metaRe.test(t)) continue;
				items.push(t);
			}
		}
		return items;
	}
	
	function scanForBubbles(scope) {
		if (!settings.bubblesEnabled) return;
		if (!scope) scope = findChatRoot();
		if (!scope) return;
		
		const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
		const opens = [];
		let tn;
		while (tn = walker.nextNode()) {
			// 跳过代码块/输入框/可编辑区里的 :::bubbles —— 那些是示例文本，不该渲染
			if (isInExcludedBubbleZone(tn)) continue;
			const txt = tn.textContent || '';
			let idx = -1, searchFrom = 0;
			while ((idx = txt.indexOf(':::bubbles', searchFrom)) >= 0) {
				let p = tn.parentElement;
				let processed = false;
				while (p && p !== scope) {
					if (p.dataset && p.dataset.wsBubblesProcessed) { processed = true; break; }
					p = p.parentElement;
				}
				if (!processed) opens.push({ node: tn, offset: idx });
				searchFrom = idx + 10;
			}
		}
		
		for (const open of opens) {
			const close = findClosingMarker(open.node, open.offset, scope);
			if (!close) continue;
			
			const range = document.createRange();
			try {
				range.setStart(open.node, open.offset);
				range.setEnd(close.node, close.offset);
			} catch (e) { continue; }
			
			const items = extractItemsInRange(range);
			if (items.length === 0) continue;
			
			const data = { type: 'suggest', title: '', question: '', mode: 'single', items };
			const fullText = range.toString();
			const metaText = fullText.substring(fullText.indexOf(':::bubbles') + 10);
			parseBubbleMetaFromText(metaText, data);
			
			const ancestor = range.commonAncestorContainer;
			const markEl = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement;
			if (!markEl) continue;
			if (markEl.dataset.wsBubblesProcessed) continue;
			markEl.dataset.wsBubblesProcessed = '1';
			
			logBubbles('检测到建议:', data.type, data.items.length, '项');
			
			const host = document.createElement('div');
			host.dataset.wsBubbleCard = '1';
			renderBubblesCard(data, host);
			
			try {
				range.deleteContents();
				range.insertNode(host);
				let cleanScope = host.parentElement;
				let depth = 0;
				while (cleanScope && cleanScope !== scope && depth < 4) {
					cleanScope.querySelectorAll('ul, ol, li, p').forEach(el => {
						if (el !== host && !el.contains(host) && !(el.textContent || '').trim() && !el.querySelector('img, svg, video, canvas')) {
							el.remove();
						}
					});
					cleanScope = cleanScope.parentElement;
					depth++;
				}
			} catch (e) {
				logBubbles('插入失败，回退:', e.message);
				const target = markEl.closest('p, div, li, section, article') || markEl;
				if (target.parentElement) {
					target.parentElement.insertBefore(host, target.nextSibling);
				}
			}
		}
	}
	
	let bubblesObserver = null;
	function startBubblesObserving() {
		if (bubblesObserver) { bubblesObserver.disconnect(); bubblesObserver = null; }
		if (!settings.bubblesEnabled) return;
		const scope = findChatRoot();
		if (!scope) {
			logBubbles('聊天根未找到，稍后重试');
			setTimeout(startBubblesObserving, 2000);
			return;
		}
		logBubbles('✅已找到聊天根，开始监听');
		bubblesObserver = new MutationObserver(() => {
			clearTimeout(window._wsBubTimer);
			window._wsBubTimer = setTimeout(() => scanForBubbles(scope), 500);
		});
		bubblesObserver.observe(scope, { childList: true, subtree: true });
		scanForBubbles(scope);
	}
	
	// ========== 汉化功能 ==========
	const EXCLUDE_SELECTOR = [
		// ── 编辑器与代码区 ──
		'.monaco-editor', '.monaco-diff-editor',
		'[class*="diffEditor"]', '[class*="diff-editor"]',
		'[class*="codeBlock"]', '[class*="code-block"]',
		'.hljs', '[class*="hljs"]',                   // highlight.js（含变体）
		'.shiki', '[class*="shiki"]',                  // Shiki 语法高亮器
		'[class*="language-"]',                        // Prism / 通用 language-xx 标记
		'[class*="token"]',                            // Prism / Monaco token spans
		'pre', 'code', 'kbd', 'samp', 'var',           // 标准代码相关元素
		'textarea', 'input', '[contenteditable="true"]',
		// ── 终端 / 输出区 ──
		'.xterm', '.terminal', '.debug-console',
		'[id*="workbench.panel.output"]',              // 输出面板
		'[id*="workbench.panel.markers"]',             // 问题/诊断面板
		// ── 自家 UI 不翻译 ──
		'.ws-bubbles', '.ws-better-panel', '#ws-recovery-toast',
		// ── Windsurf 模型选择器面板 ──
		'[aria-label*="Model Selector"]', '[aria-label*="\u6a21\u578b\u9009\u62e9"]',
		'[class*="model-selector"]', '[class*="modelSelector"]',
		// ── 文件名/路径相关：禁止翻译文件夹/文件名 ──
		'.explorer-folders-view',                      // 资源管理器文件树
		'[id*="workbench.view.explorer"]',             // Explorer 视图容器
		'[id*="workbench.view.search"]',               // 搜索结果
		'[id*="workbench.view.scm"]',                  // 源代码管理（变更文件列表）
		'.outline-tree',                               // 大纲视图
		'.monaco-list-row[role="treeitem"]',           // 任意树视图的行
		'.monaco-icon-label',                          // 带图标的文件/路径标签
		'.breadcrumbs',                                // 面包屑导航
		'.tabs-container .tab',                         // 编辑器标签页
		'.editor-group-container .title',              // 编辑器组标题区
		'.statusbar',                                  // 状态栏（含文件路径/git 分支）
		// ── Cascade 聊天代码/工具调用区 ──
		'[class*="markdown-body"]', '[class*="markdownBody"]',  // markdown 渲染容器（含代码块）
		'[class*="tool-call"]', '[class*="toolCall"]', '[class*="tool_call"]',  // 工具调用展示
		'[class*="code-citation"]', '[class*="codeCitation"]',  // 代码引用
		'[class*="file-citation"]', '[class*="fileCitation"]',  // 文件引用
		'[class*="diff-line"]', '[class*="diffLine"]',          // 内嵌 diff 行
		'[data-language]',                             // 标注了语言的代码块容器
		'[role="code"]',                               // ARIA code 角色
		// ── 笔记本 ──
		'.notebook-editor', '.notebook-cell-list',
		'[class*="cell-editor-part"]',
		// ── Quick Pick / 命令面板（常含文件路径） ──
		'.quick-input-widget',
		'.quick-input-list',
		// ── Hover 浮窗里的代码 ──
		'.monaco-hover code',
		'.monaco-hover pre',
		// ── Notification 中的命令/路径 ──
		'.notification-list-item-source',
		'.notification-list-item-detail-row code'
	].join(', ');
	// 模型名标识正则：文本包含已知模型/智能体名称时跳过翻译（避免翻译模型限定词如 Thinking/Fast/Medium）
	const MODEL_LABEL_SKIP_RE = /\b(claude|gpt-?\d|gpt-?o|o\d-|gemini|llama|qwen|deepseek|mistral|mixtral|swe-?\d|grok|haiku|sonnet|opus|codestral|devstral|devin)\b/i;
	// 描述性词汇指示符：含这些词时认为是描述/说明文字而非模型标签，不跳过翻译
	const MODEL_DESC_RE = /\b(for|via|using|with|agent|coding|powered|based|built|available|supported|requires?|enables?|provides?|settings|apply|saved|balance|draw|from|describe|task)\b/i;
	const ATTRS_TO_TRANSLATE = ['aria-label', 'title', 'placeholder', 'data-tooltip'];
	
	const TRANSLATIONS = new Map([
		// ========== Section 标题 ==========
		['User Interface', '用户界面'],
		['Windsurf Tab', 'Windsurf 补全'],
		['Shortcuts', '快捷键'],
		['Advanced', '高级'],
		['General', '通用'],
		['Editor', '编辑器'],
		['Cascade', 'Cascade'],
		['Cascade Configuration', 'Cascade 配置'],
		['Notifications', '通知'],
		['Agent', '智能体'],
		['Agents', '智能体'],
		['Settings', '设置'],
		['Account', '账户'],
		['Profile', '个人资料'],
		['Subscription', '订阅'],
		
		// ========== User Interface 设置 ==========
		['Show Inlay Shortcuts', '显示内联快捷键'],
		['Show in-line shortcut actions while the cursor is on an empty line', '当光标在空行上时，显示行内快捷操作'],
		['Show Explain Problem Inlay Hint', '显示问题解释内联提示'],
		['Show in-line explain problem actions while the cursor is on a line with an error squiggle', '当光标所在行有错误波浪线时，在行内显示解释问题的操作'],
		['Show Selection Popup', '显示选区弹窗'],
		['Show clickable shortcut popup when selecting text', '选中文本时显示浮动快捷弹窗'],
		['Scroll to Next Diff on Accept', '接受时滚动到下一个差异'],
		['Automatically scroll to the next Diff when accepting the current one', '接受当前差异时自动滚动到下一个差异'],
		
		// ========== Windsurf Tab 设置 ==========
		['Completion Mode', '补全模式'],
		['Choose your preferred code completion experience', '选择你偏好的代码补全体验'],
		['Aggression', '主动程度'],
		['Controls how proactively Supercomplete suggests edits near your cursor', '控制 Supercomplete 在光标附近主动建议编辑的频率'],
		['Tab to Jump', 'Tab 跳转'],
		['Predict the location of your next edit and navigates you there with a tab keypress', '预测下一个编辑位置，按 Tab 跳转到该位置'],
		['Tab to Import', 'Tab 导入'],
		['Quickly add and update imports with a tab keypress', '按 Tab 快速添加和更新导入语句'],
		['Clipboard Context', '剪贴板上下文'],
		['When enabled, Windsurf will use the clipboard as context for completions', '启用后，Windsurf 将使用剪贴板内容作为补全的上下文'],
		['Auto-Generate Memories', '自动生成记忆'],
		['When enabled, Cascade will autonomously generate memories to remember important context. When disabled, Cascade will only create memories when you explicitly ask', '启用后，Cascade 将自动生成记忆以记住重要上下文。禁用后，Cascade 仅在你明确要求时创建记忆'],
		['Allow Cascade in Background', '允许 Cascade 在后台运行'],
		['When enabled, Windsurf will allow Cascade to run in the background. When disabled, switching conversations will stop Cascade. Terminal commands may run in the background depending on your Terminal Auto Execution setting', '启用后，Windsurf 允许 Cascade 在后台运行。禁用后，切换对话将停止 Cascade。终端命令可能根据你的终端自动执行设置在后台运行'],
		['Auto-Continue', '自动继续'],
		['Controls whether Cascade automatically continues when it reaches the invocation limit. When on, Cascade continues indefinitely without prompting. When off, Cascade stops at the invocation limit and asks you to continue', '控制 Cascade 达到调用限制时是否自动继续。开启时，Cascade 无限期继续而无需提示。关闭时，Cascade 在调用限制处停止并询问你是否继续'],
		['Disable Fast Context Agent', '禁用快速上下文智能体'],
		['Disable the Fast Context agent that executes parallel searches as a subagent', '禁用执行并行搜索的快速上下文智能体'],
		['Arena Always Open Fullscreen', 'Arena 始终全屏打开'],
		['When enabled, Arena mode sessions will automatically open in the editor tab for a side-by-side view', '启用后，Arena 模式会话将自动在编辑器标签页中打开以进行并排视图'],
		['Cascade Completion Notifications', 'Cascade 完成通知'],
		['Show notifications when a Cascade finishes while in the background', '当 Cascade 在后台完成时显示通知'],
		['Always Notify on Cascade Completion', '始终通知 Cascade 完成'],
		['Show notifications when a Cascade finishes, even when the panel is open and focused', '当 Cascade 完成时显示通知，即使面板已打开且处于焦点状态'],
		['Read Claude Code Config', '读取 Claude Code 配置'],
		['When enabled, Cascade will read skills from .claude directories (both local .claude/skills/ and global ~/.claude/skills/)', '启用后，Cascade 将从 .claude 目录读取技能（包括本地 .claude/skills/ 和全局 ~/.claude/skills/）'],
		
		// ========== Cascade Configuration 设置 ==========
		['Explain and Fix in Current Conversation', '在当前对话中解释和修复'],
		['Send explain and fix request to the current conversation', '向当前对话发送解释和修复请求'],
		['Gitignore access', 'Gitignore 访问权限'],
		['Allow Cascade, tab, and supercomplete to view and edit the files in .gitignore', '允许 Cascade、tab 和 supercomplete 查看和编辑 .gitignore 中的文件'],
		['Cascade Auto-Fix Lints', 'Cascade 自动修复 Lint 错误'],
		['When enabled, Cascade is given awareness of lint errors created by its edits and may fix them without explicit user prompting. Note that this may increase Cascade\'s tool usage', '启用后，Cascade 会感知自身编辑引发的 lint 错误，并可能自动修复。注意：这可能会增加工具调用次数'],
		['Windsurf Preview', 'Windsurf 预览'],
		['When enabled, Cascade will be able to open local browser previews of sites running on development servers that Cascade has started. These browser previews provide special functionalities to integrate Cascade more tightly in the development cycle', '启用后，Cascade 可以打开其启动的开发服务器的本地浏览器预览，让 Cascade 更深度参与开发流程'],
		['Auto Execution', '自动执行'],
		['Disabled - All terminal commands require manual approval', '已禁用 - 所有终端命令需要手动批准'],
		['Auto Web Requests', '自动 Web 请求'],
		['Disabled - All web requests require manual approval', '已禁用 - 所有 Web 请求需要手动批准'],
		
		// ========== Advanced 设置 ==========
		['Search Max Workspace File Count', '最大工作区文件搜索数'],
		['Windsurf will attempt to compute embeddings for workspaces up to this many files. This file count ignores .gitignore and binary files. Raising this limit from the default value may lead to performance issues. Values 0 or below will be treated as unlimited', 'Windsurf 会对不超过此文件数的工作区生成索引（不含 .gitignore 和二进制文件）。调高此值可能影响性能，设为 0 或负数表示无限制'],
		['Open Editor Settings', '打开编辑器设置'],
		['For general editor settings, visit the Editor Settings Page', '对于常规编辑器设置，请访问编辑器设置页面'],
		['Customize Application Icon', '自定义应用图标'],
		['Choose your Windsurf Application Icon among a few custom presets', '从几个自定义预设中选择你的 Windsurf 应用图标'],
		['Enable ACP', '启用 ACP'],
		['Enable or disable ACP (Agent Client Protocol) entirely. When off, no agents are instantiated', '完全启用或禁用 ACP（代理客户端协议）。关闭时，不会实例化任何代理'],
		['Marketplace Extension Gallery Service URL', 'Marketplace 扩展库服务 URL'],
		['Change the base URL for marketplace search results. You must restart Windsurf to use the new marketplace after changing the value', '更改 marketplace 搜索结果的基础 URL。更改值后必须重启 Windsurf 才能使用新的 marketplace'],
		['Marketplace Gallery Item URL', 'Marketplace 库项目 URL'],
		['Changes the base URL on each extension page. You must restart Windsurf to use the new marketplace after changing this value', '更改每个扩展页面的基础 URL。更改值后必须重启 Windsurf 才能使用新的 marketplace'],
		
		// ========== Shortcuts 设置 ==========
		['Open Command', '打开命令'],
		['Open Chat with Cascade', '打开 Cascade 聊天'],
		['View All Windsurf shortcuts', '查看所有 Windsurf 快捷键'],
		['Open Command Palette', '打开命令面板'],
		['Change keybindings', '修改快捷键'],
		['Keyboard Shortcuts', '键盘快捷键'],
		['Reset to default shortcuts', '重置为默认快捷键'],
		['Reset to defaults', '重置为默认'],
		
		// ========== 选项值 ==========
		// ['Low', '低'],     // 移除：保留原文（模型推理强度等上下文使用）
		['Conservative suggestions with higher confidence', '保守的建议，置信度更高'],
		// ['Medium', '中等'],  // 移除：保留原文
		['Balanced suggestions', '平衡的建议'],
		// ['High', '高'],    // 移除：保留原文
		['More frequent and ambitious suggestions', '更频繁、更大胆的建议'],
		['Supercomplete', '超级补全'],
		['Intelligent edit suggestions near your cursor', '光标附近的智能编辑建议'],
		['Autocomplete', '自动补全'],
		['Standard inline completions without side hint code box suggestions', '标准内联补全，不含侧边代码提示框'],
		['OFF', '关闭'],
		['Disable all code completions', '禁用所有代码补全'],
		['Disabled', '已禁用'],
		['Auto-execution is disabled for all commands', '所有命令的自动执行已禁用'],
		['Auto-fetching is disabled for all web requests', '所有 Web 请求的自动获取已禁用'],
		['Allowlist', '允许列表'],
		['Never auto-execute commands unless they are in your allow list', '除非命令在你的允许列表中，否则不自动执行'],
		['Only auto-fetch URLs from origins in your allow list', '仅自动获取允许列表中来源的 URL'],
		['Auto', '自动'],
		['Cascade model will decide which commands are safe to auto-execute. This is only available for premium models', 'Cascade 模型将决定哪些命令可以安全地自动执行。此功能仅适用于高级模型'],
		['Turbo', '极速'],
		['Always auto-execute commands unless they are in your deny list. This also allows Cascade to auto-execute Browser controls', '自动执行命令，除非在拒绝列表中。同时允许 Cascade 自动控制浏览器'],
		['Always auto-fetch all web requests', '始终自动获取所有 Web 请求'],
		
		// ========== 通用选项 ==========
		['On', '开启'],
		['Off', '关闭'],
		['Enabled', '已启用'],
		['Yes', '是'],
		['No', '否'],
		['None', '无'],
		['Default', '默认'],
		['Custom', '自定义'],
		['Manual', '手动'],
		
		// ========== 其他界面文本 ==========
		['Search settings...', '搜索设置...'],
		['Search settings', '搜索设置'],
		['Log in to Windsurf', '登录 Windsurf'],
		['Getting started with Windsurf', '开始使用 Windsurf'],
		['Code with Cascade', '使用 Cascade 编码'],
		['Edit code inline', '内联编辑代码'],
		['Open Agent Window', '打开智能体窗口'],
		['Thought', '思考'],
		['Created Todo List', '已创建任务列表'],
		['Analyzed content', '已分析内容'],
		// 'tasks done' 由正则 "N tasks done" 处理；单独出现见下方 1235 行
		// 'chunks' 不做静态翻译，避免误翻文件夹名
		['Failed to fetch document content at', '无法获取文档内容：'],
		['Markdown', 'Markdown'],
		['UTF-8', 'UTF-8'],
		['Ctrl', 'Ctrl'],
		['Shift', 'Shift'],
		['Alt', 'Alt'],
		['Cmd', 'Cmd'],
		['Win', 'Win'],
		['Detect Proxy', '自动检测代理'],
		['Enable automatic proxy detection. Toggling this will force Windsurf to reload', '启用自动代理检测。切换此选项将强制 Windsurf 重新加载'],

		// ========== MCP 相关 ==========
		['MCP Servers', 'MCP 服务器'],
		['Browse and install MCP servers', '浏览并安装 MCP 服务器'],
		['Open MCP Registry', '打开 MCP 注册表'],
		['Manage installed servers', '管理已安装的服务器'],
		['Install', '安装'],
		['Uninstall', '卸载'],
		['Server URL', '服务器 URL'],
		['Command', '命令'],
		['Environment Variables', '环境变量'],
		['Arguments', '参数'],
		['Headers', '请求头'],
		['Getting Started', '入门指南'],
		['No tools found', '未找到工具'],
		['All Tools', '所有工具'],
		['No description available', '无可用描述'],
		['required', '必需'],
		['secret', '机密'],
		['Remote Endpoints', '远程端点'],
		['Click **Install** to add this MCP server to your configuration', '点击 **安装** 将此 MCP 服务器添加到你的配置'],
		['Set the required environment variables below', '在下方设置必需的环境变量'],
		['The server\'s tools will be available in Cascade', '服务器的工具将在 Cascade 中可用'],

		// ========== Plan 和 Quota 相关 ==========
		['Plan ends', '套餐到期'],
		['Daily quota usage', '每日配额使用'],
		['Weekly quota usage', '每周配额使用'],
		['Extra usage balance', '额外使用余额'],
		['Purchase extra usage', '购买额外使用量'],
		['Auto refill settings', '自动充值设置'],
		['Configure auto refill', '配置自动充值'],
		['Manage your plan', '管理你的套餐'],
		['Upgrade', '升级'],
		['Downgrade', '降级'],
		['Cancel', '取消'],
		['Billing', '账单'],
		['Payment method', '支付方式'],
		['Invoice', '发票'],
		['Usage', '使用量'],
		['Resets daily', '每日重置'],
		['Resets weekly', '每周重置'],
		['Resets monthly', '每月重置'],
		['Trial', '试用'],
		['Free', '免费'],
		['Pro', '专业版'],
		['Plan Info', '套餐信息'],

		// ========== 右键菜单 / 面板菜单 ==========
		['Open Preview', '打开预览'],
		['Deploy', '部署'],
		['Download Trajectory', '下载对话记录'],
		['Cascade Usage', 'Cascade 使用量'],
		['Download Diagnostics', '下载诊断信息'],
		['Configure Rules', '配置规则'],
		['Configure Skills', '配置技能'],
		['Configure Workflows', '配置工作流'],
		['Edit Memories', '编辑记忆'],
		['MCPs', 'MCP 服务'],

		// ========== Customizations 页面 ==========
		['Customizations', '自定义'],
		['Customize Cascade to get a better, more personalized experience.', '自定义 Cascade，打造更个性化的体验。'],
		['Customize Cascade to get a better, more personalized experience', '自定义 Cascade，打造更个性化的体验'],
		['Learn more', '了解更多'],
		['Rules', '规则'],
		['Skills', '技能'],
		['Workflows', '工作流'],
		['Memories', '记忆'],
		['Rules help guide the behavior of Cascade. Global rules are automatically included in memory.', '规则帮助引导 Cascade 的行为。全局规则会自动包含在记忆中。'],
		['Workspace', '工作区'],
		['Global', '全局'],
		['Back', '返回'],
		['Cascade Rules', 'Cascade 规则'],
		['Rules help guide the behavior of Cascade.', '规则帮助引导 Cascade 的行为。'],
		['Manage rules', '管理规则'],
		['Workflows are saved prompts that Cascade can follow. To trigger a workflow, type "/" in Cascade.', '工作流是 Cascade 可以遵循的已保存提示。要触发工作流，在 Cascade 中输入 "/"。'],
		['Manage workflows', '管理工作流'],
		['Cascade Memories', 'Cascade 记忆'],
		['View and edit Cascade generated memories', '查看和编辑 Cascade 生成的记忆'],
		['View memories', '查看记忆'],
		['Manage', '管理'],
		['Search memories', '搜索记忆'],
		['Memories are automatically generated by Cascade to maintain context between conversations.', '记忆由 Cascade 自动生成，用于在对话之间保持上下文。'],
		['No auto-generated memories', '暂无自动生成的记忆'],

		// ========== Configuration 设置（截图3: 描述文本） ==========
		['Configuration', '配置'],
		['When enabled, Windsurf will allow Cascade to run in the background. When disabled, switching conversations will stop Cascade. Terminal commands may run in the background depending on your Terminal Auto Execution setting.', '启用后，Windsurf 允许 Cascade 在后台运行。禁用后，切换对话将停止 Cascade。终端命令可能根据你的终端自动执行设置在后台运行。'],
		['When enabled, Arena mode sessions will automatically open in the editor tab for a side-by-side view.', '启用后，Arena 模式会话将自动在编辑器标签页中打开以进行并排视图。'],
		['Show Allowlist', '显示允许列表'],
		['Disabled - All terminal commands require manual approval.', '已禁用 - 所有终端命令需要手动批准。'],
		['Allowlist - Only allowlisted terminal commands are auto-executed.', '允许列表 - 仅允许列表中的终端命令会自动执行。'],
		['Auto - The model decides whether to auto-execute a command (premium models only)', '自动 - 模型决定是否自动执行命令（仅限高级模型）'],
		['Turbo - All terminal commands are auto-executed (except those in the denylist)', '极速 - 所有终端命令自动执行（拒绝列表中的除外）'],
		['Disabled - All web requests require manual approval.', '已禁用 - 所有 Web 请求需要手动批准。'],
		['Allowlist - Only allowlisted origins are auto-fetched.', '允许列表 - 仅自动获取允许列表中来源的请求。'],
		['Turbo - All web requests are auto-fetched.', '极速 - 所有 Web 请求自动获取。'],
		['Controls whether Cascade automatically continues when it reaches the invocation limit. When on, Cascade continues indefinitely without prompting. When off, Cascade stops at the invocation limit and asks you to continue.', '控制 Cascade 达到调用限制时是否自动继续。开启时，Cascade 无限期继续而无需提示。关闭时，Cascade 在调用限制处停止并询问你是否继续。'],
		['When enabled, Cascade will autonomously generate memories to remember important context. When disabled, Cascade will only create memories when you explicitly ask.', '启用后，Cascade 将自动生成记忆以记住重要上下文。禁用后，Cascade 仅在你明确要求时创建记忆。'],
		['Auto-Open Edited Files', '自动打开编辑的文件'],
		['Open files in the background if Cascade creates or edits them', '如果 Cascade 创建或编辑了文件，则在后台打开它们'],
		['When enabled, Cascade is given awareness of lint errors created by its edits and may fix them without explicit user prompting. Note that this may increase Cascade\'s tool usage.', '启用后，Cascade 会感知自身编辑引发的 lint 错误，并可能自动修复。注意：这可能会增加工具调用次数。'],

		// ========== Enable Cascade ==========
		['Enable Cascade', '启用 Cascade'],
		['When disabled, Cascade is not available and only ACP agents can be used.', '禁用后，Cascade 将不可用，只能使用 ACP 智能体。'],

		// ========== Agent Diff Zones ==========
		['Agent Diff Zones', '智能体 Diff 区域'],
		['Show interactive diff zones with accept/reject controls for agent file edits', '显示带有接受/拒绝控件的交互式 diff 区域，用于智能体文件编辑'],

		// ========== 截图4: Enable Cascade Web Tools 等 ==========
		['Enable Cascade Web Tools', '启用 Cascade Web 工具'],
		['When enabled, Cascade can perform web searches on the open Internet. This does not affect Cascade\'s ability to read specific URLs, which is performed locally on your machine.', '启用后，Cascade 可以在互联网上执行 Web 搜索。这不影响 Cascade 读取特定 URL 的能力，该操作在本地执行。'],
		['Send explain and fix request to the current conversation.', '向当前对话发送解释和修复请求。'],
		['Allow Cascade, tab, and supercomplete to view and edit the files in .gitignore.', '允许 Cascade、Tab 和超级补全查看和编辑 .gitignore 中的文件。'],
		['When enabled, Cascade will read skills from .claude directories (both local .claude/skills/ and global ~/.claude/skills/).', '启用后，Cascade 将从 .claude 目录读取技能（包括本地 .claude/skills/ 和全局 ~/.claude/skills/）。'],
		['When enabled, Cascade will be able to open local browser previews of sites running on development servers that Cascade has started. These browser previews provide special functionalities to integrate Cascade more tightly in the development cycle.', '启用后，Cascade 可以打开其启动的开发服务器的本地浏览器预览，让 Cascade 更深度参与开发流程。'],
		['Disable the Fast Context agent that executes parallel searches as a subagent.', '禁用执行并行搜索的快速上下文子智能体。'],

		// ========== 截图5: Devin for Terminal ==========
		['Devin for Terminal', 'Devin 终端'],
		['Patterns for tools/commands that are always allowed.', '始终允许的工具/命令模式。'],
		['Patterns for tools/commands that are always denied.', '始终拒绝的工具/命令模式。'],
		['Patterns for tools/commands that require confirmation.', '需要确认的工具/命令模式。'],
		['Allow', '允许'],
		['Deny', '拒绝'],
		['Ask', '询问'],
		['Add Item', '添加项'],
		['Open config.json in editor', '在编辑器中打开 config.json'],

		// ========== 截图6: 高级页 ==========
		['Enable automatic proxy detection. Toggling this will force Windsurf to reload.', '启用自动代理检测。切换此选项将强制 Windsurf 重新加载。'],
		['Windsurf will attempt to compute embeddings for workspaces up to this many files. This file count ignores .gitignore and binary files. Raising this limit from the default value may lead to performance issues. Values 0 or below will be treated as unlimited.', 'Windsurf 会对不超过此文件数的工作区生成索引（不含 .gitignore 和二进制文件）。调高此值可能影响性能，设为 0 或负数表示无限制。'],
		['Enable or disable ACP (Agent Client Protocol) entirely. When off, no agents are instantiated.', '完全启用或禁用 ACP（代理客户端协议）。关闭时，不会实例化任何代理。'],

		// ========== 截图2: 设置页描述文本 ==========
		['Change the base URL for marketplace search results. You must restart Windsurf to use the new marketplace after changing the value.', '更改 Marketplace 搜索结果的基础 URL。更改值后必须重启 Windsurf 才能使用新的 Marketplace。'],
		['Available marketplace options.', '可用的 Marketplace 选项。'],
		['Changes the base URL on each extension page. You must restart Windsurf to use the new marketplace after changing this value.', '更改每个扩展页面的基础 URL。更改值后必须重启 Windsurf 才能使用新的 Marketplace。'],
		['Available options.', '可用选项。'],
		['Browse and install MCP servers from the Cascade MCP store. Manage installed MCPs including enabling or disabling them at both server and individual tool level.', '从 Cascade MCP 商店浏览并安装 MCP 服务器。管理已安装的 MCP，包括在服务器和单个工具级别启用或禁用它们。'],

		// ========== 截图3: 面板设置 ==========
		['Advanced Settings', '高级设置'],
		['AI Shortcuts', 'AI 快捷键'],

		// ========== 通用操作 ==========
		['Save', '保存'],
		['Delete', '删除'],
		['Edit', '编辑'],
		['Close', '关闭'],
		['Apply', '应用'],
		['Reset', '重置'],
		['Confirm', '确认'],
		['Search', '搜索'],
		['Refresh', '刷新'],
		['Copy', '复制'],
		['Paste', '粘贴'],
		['Undo', '撤销'],
		['Redo', '重做'],
		['Error', '错误'],
		['Warning', '警告'],
		['Info', '信息'],
		['Success', '成功'],
		['Loading', '加载中'],
		['Retry', '重试'],

		// ========== 模型选择相关 ==========
		['Search all models', '搜索所有模型'],
		['Group by', '分组'],
		['Adaptive', '自适应'],
		['Automatically balances quality and cost', '自动平衡质量和成本'],
		['Add Opus 4.5 for difficult problems and planning', '添加 Opus 4.5，用于困难问题和规划'],
		['Recently Used', '最近使用'],
		['Recommended', '推荐'],
		// ['New', '新'],  // 移除：模型徒章/徒章上下文保留原文
		// 'context' 不做静态翻译，避免误翻文件夹名；"NK context" 和 "context used" 已由正则/长短语覆盖
		// ['Thinking', '思考'],  // 移除：避免误翻模型限定词（带标点的 Thinking.. / Thinking. 仍正常翻译）
		['Cost', '成本'],
		['Higher effort consumes more tokens', '越高越消耗 tokens'],
		['Input', '输入'],
		['Cached input', '缓存输入'],
		['Effort', '推理强度'],
		['Output', '输出'],
		['tokens', 'tokens'],

		// ========== 聊天模式相关 ==========
		['Code', '代码'],
		['Can write and edit code', '可以编写和编辑代码'],
		['Reads but won\'t edit', '读取但不会编辑'],
		['Plan changes before implementing', '先规划，再实施'],
		['Use', '使用'],
		['to switch modes', '切换模式'],
		['Ask anything', '询问任何问题'],
		['Single', '单模型'],
		['Arena', '竞技场'],

		// ========== 输入框菜单 ==========
		['Mentions', '提及'],
		['Trigger Workflow', '触发工作流'],
		['Upload Image', '上传图片'],

		// ========== 顶部标签和按钮 ==========
		['Chat', '聊天'],
		['Composer', '编排'],
		['Documentation', '文档'],
		['Commit', '提交'],
		['Continue', '继续'],
		['Accept', '接受'],
		['Reject', '拒绝'],
		['Generating', '生成中'],
		['Complete', '完成'],
		['Insert', '插入'],

		// ========== AI补全相关 ==========
		['Codeium', 'Codeium'],
		['Generating code...', '正在生成代码...'],
		['Tab to accept', '按 Tab 接受'],
		['Press Tab to accept', '按 Tab 接受'],
		['for more options', '查看更多选项'],
		['Show next', '显示下一个'],
		['Show previous', '显示上一个'],

		// ========== 文件/编辑器相关 ==========
		['New File', '新文件'],
		['New Folder', '新文件夹'],
		['Open File', '打开文件'],
		['Open Folder', '打开文件夹'],
		['Save All', '保存全部'],
		['Close Editor', '关闭编辑器'],
		['Close All', '关闭全部'],
		['Split Editor', '拆分编辑器'],
		['Go to File', '转到文件'],
		['Go to Symbol', '转到符号'],
		['Find in Files', '在文件中查找'],
		['Replace in Files', '在文件中替换'],
		['Recent Files', '最近的文件'],
		['Clear Recent', '清除最近'],

		// ========== 终端相关 ==========
		['Terminal', '终端'],
		['New Terminal', '新建终端'],
		['Split Terminal', '拆分终端'],
		['Kill Terminal', '关闭终端'],
		['Clear', '清除'],
		['Scroll to bottom', '滚动到底部'],

		// ========== 状态相关 ==========
		['Ready', '就绪'],
		['Busy', '忙碌'],
		['Disconnected', '已断开'],
		['Connecting', '连接中'],
		['Syncing', '同步中'],
		['Indexing', '索引中'],
		['Analyzing', '分析中'],
		['Building', '构建中'],
		['Testing', '测试中'],
		['Debugging', '调试中'],

		// ========== Git相关 ==========
		['Source Control', '源代码管理'],
		['Changes', '更改'],
		['Staged Changes', '暂存更改'],
		['Untracked', '未跟踪'],
		['Modified', '已修改'],
		['Added', '已添加'],
		['Deleted', '已删除'],
		['Renamed', '已重命名'],
		['Message', '消息'],
		['Stage All', '全部暂存'],
		['Unstage All', '全部取消暂存'],
		['Discard Changes', '放弃更改'],
		['View Changes', '查看更改'],
		['Pull', '拉取'],
		['Push', '推送'],
		['Fetch', '获取'],
		['Sync', '同步'],
		['Branch', '分支'],
		['Create Branch', '创建分支'],
		['Switch Branch', '切换分支'],
		['Merge Branch', '合并分支'],
		['Delete Branch', '删除分支'],
		['Checkout', '签出'],
		['Cherry-pick', '遴选'],
		['Revert', '还原'],
		['Stash', '贮藏'],
		['Stash All', '全部贮藏'],
		['Pop Stash', '弹出贮藏'],
		['Drop Stash', '删除贮藏'],

		// ========== MCP Registry 页面 ==========
		['MCP Registry', 'MCP 注册表'],
		['Installed', '已安装'],
		['Available', '可用'],
		// 'tools' 不做静态翻译，避免误翻文件夹名；动态 "N tools" 已由 REGEX_TRANSLATIONS 覆盖
		['Enabled', '已启用'],
		['Error', '错误'],
		['No tools found.', '未找到工具。'],
		['Quota resets daily/weekly.', '配额每日/每周重置。'],
		['Purchase extra usage or manage auto refill', '购买额外使用量或管理自动充值'],

		// ========== Plan Info 页面（截图1） ==========
		['Daily quota usage:', '每日配额使用:'],
		['Weekly quota usage:', '每周配额使用:'],
		['Extra usage balance:', '额外使用余额:'],
		['Resets', '重置于'],
		['Plan', '套餐'],
		['Plan ends in', '套餐剩余'],
		['daily/weekly', '每日/每周'],
		// 'days' 不做静态翻译，避免误翻文件夹名；"Plan ends in N days" 已由正则覆盖

		// ========== Devin Terminal 描述（截图2） ==========
		['These settings only apply to Devin for Terminal and are saved to', '这些设置仅适用于 Devin 终端，并保存到'],

		// ========== Windsurf Tab 描述带句号版（截图3） ==========
		['When enabled, Windsurf will use the clipboard as context for completions.', '启用后，Windsurf 将使用剪贴板内容作为补全的上下文。'],
		['Quickly add and update imports with a tab keypress.', '按 Tab 快速添加和更新导入语句。'],
		['Predict the location of your next edit and navigates you there with a tab keypress.', '预测下一个编辑位置，按 Tab 跳转到该位置。'],
		['Controls how proactively Supercomplete suggests edits near your cursor.', '控制 Supercomplete 在光标附近主动建议编辑的频率。'],
		['Choose your preferred code completion experience.', '选择你偏好的代码补全体验。'],

		// ========== Agents 页面（截图4） ==========
		['No environment variables set.', '未设置环境变量。'],
		['Add', '添加'],

		// ========== 模型选择器分组菜单 ==========
		['Provider', '提供商'],
		['Input cost', '输入成本'],
		['Cached input cost', '缓存输入成本'],
		['Output cost', '输出成本'],
		['All models draw from your Devin ACU balance', '所有模型从你的 Devin ACU 余额中扣费'],

		// ========== 底部栏 ==========
		['Reject all', '全部拒绝'],
		['Accept all', '全部接受'],
		['Windsurf - Settings', 'Windsurf - 设置'],

		// ========== Cascade 状态文本 ==========
		['Surfing..', '驰骋中..'],
		['Surfing.', '驰骋中.'],
		['Exploring..', '探索中..'],
		['Exploring.', '探索中.'],
		['Floating..', '酝酿中..'],
		['Floating.', '酝酿中.'],
		['Thinking..', '思考中..'],
		['Thinking.', '思考中.'],
		['Generating..', '生成中..'],
		['Generating.', '生成中.'],
		['Sailing..', '航行中..'],
		['Sailing.', '航行中.'],

		// ========== 输入框/模式切换 ==========
		['Switch mode', '切换模式'],
		['+ Add', '+ 添加'],

		// ========== Skills 页面 ==========
		['Skills are rules or workflows with additional resources that the model can choose to invoke.', '技能是模型可以选择调用的规则或工作流，包含额外资源。'],
		// 'resources' 不做静态翻译，避免误翻文件夹名；动态 "N resources" 已由 REGEX_TRANSLATIONS 覆盖

		// ========== 发送按钮菜单 ==========
		['Queue', '排队发送'],
		['Send now', '立即发送'],

		// ========== 顶栏按钮 tooltip ==========
		['Past Conversations', '历史对话'],
		['Start a New Conversation', '开始新对话'],
		['Start recording', '开始录音'],
		['Add Context', '添加上下文'],
		['Model Selector', '模型选择'],
		['Conversation', '对话'],

		// ========== 欢迎页 ==========
		['Start', '开始'],
		['Generate a New Project', '创建新项目'],
		['Clone Repository', '克隆仓库'],
		['Connect via SSH', '通过 SSH 连接'],
		['Recent Projects', '最近的项目'],
		['Show More...', '显示更多...'],

		// ========== 会话管理页面 ==========
		['All sessions', '所有会话'],
		['New session', '新建会话'],
		['Spaces', '空间'],
		['Running', '运行中'],
		['Blocked', '已阻塞'],
		['Uncategorized', '未分类'],
		['Search sessions...', '搜索会话...'],
		['Search sessions', '搜索会话'],
		['Last 24 hours', '最近 24 小时'],
		['Include archived', '包含已归档'],
		['Rename', '重命名'],
		['Archive', '归档'],
		['Unarchive', '取消归档'],
		['Last run', '上次运行'],
		// 'files' 不做静态翻译，避免误翻文件夹名；"N files" 已由 REGEX_TRANSLATIONS 覆盖
		['cascade', 'cascade'],

		// ========== 文件变更区域 ==========
		['files with changes', '个文件有变更'],
		['View all', '查看全部'],
		['View all changes', '查看所有变更'],
		['MCP servers', 'MCP 服务器'],

		// ========== 会话筛选 ==========
		['Exclude archived', '排除已归档'],
		['Only archived', '仅已归档'],
		['Unassigned', '未分配'],
		['Time is', '时间为'],
		['just now', '刚刚'],

		// ========== 上下文/缓存状态 ==========
		['context used', '上下文已用'],
		['Prompt cache expires in', '提示缓存过期于'],
		['Send', '发送'],
		['message queued', '条消息排队中'],
		['1 message queued', '1 条消息排队中'],
		['2 messages queued', '2 条消息排队中'],
		['3 messages queued', '3 条消息排队中'],
		['Message with attachments', '带附件的消息'],
		['Enter to send queued message', '按回车发送排队消息'],
		['Queued messages will be sent one at a time. Click to send this message now.', '排队消息将逐条发送。点击可立即发送此消息。'],
		['Queued messages will be sent one at a time. Press', '排队消息将逐条发送。按'],
		['or click here to send the first queued message.', '或点击此处发送第一条排队消息。'],
		['messages queued', '条消息排队中'],

		// ========== 排队消息操作 ==========
		['Edit message', '编辑消息'],
		['Remove from queue', '从队列移除'],

		// ========== 终端命令相关 ==========
		['Command Auto-ran', '命令已自动运行'],
		['Copy command', '复制命令'],
		['Moves this terminal session to the Terminal tab in your IDE. Cascade will still be able to use it.', '将此终端会话移至 IDE 的终端标签页。Cascade 仍可使用它。'],
		['Review', '审查'],

		// ========== 欢迎页描述 ==========
		['Kick off a new project. Make changes across your entire codebase.', '启动一个新项目。在整个代码库中进行更改。'],

		// ========== 欢迎页快捷键 ==========
		['Cascade in new tab', '在新标签页中打开 Cascade'],

		// ========== 远程连接菜单 ==========
		['Connect to SSH Host...', '连接到 SSH 主机...'],
		['Connect to SSH Host in Current Window...', '在当前窗口连接到 SSH 主机...'],
		['Open Folder in Container', '在容器中打开文件夹'],
		['Attach to Running Container', '附加到运行中的容器'],
		['Reopen in Container', '在容器中重新打开'],
		['Connect to WSL', '连接到 WSL'],
		['Connect to WSL using Distro...', '使用发行版连接到 WSL...'],

		// ========== Cascade 对话区域 ==========
		['Thoughts', '思考过程'],
		['Analyzed', '已分析'],
		['tasks done', '个任务完成'],
		['more', '更多'],
		['Read', '读取'],

		// ========== 配额提示条 ==========
		['You\'ve used', '已使用'],
		['of your quota', '的配额'],
		['Quota resets', '配额重置于'],
		['Promo pricing is active for a limited time', '限时促销价生效中'],
		['tokens', 'tokens'],
		// ['Fast', '快速'],  // 移除：模型限定词，保留原文
		['Connecting to server...', '正在连接服务器...'],
		['Your included daily usage quota is exhausted.', '您的每日配额已用完。'],
		['Your included usage quota is exhausted.', '您的配额已用完。'],
		['to continue using premium models.', '以继续使用高级模型。'],
		['Purchase additional usage', '购买额外使用量'],

		// ========== Codemaps ==========
		['Codemaps', '代码地图'],
		['Suggestions from recent activity', '根据最近活动推荐'],
		['Your Codemaps', '你的代码地图'],
		['Search', '搜索'],
		['No codemaps found for this repository.', '此仓库未找到代码地图。'],
		['Show Archived Codemaps', '显示已归档的代码地图'],
		['Only Starred Codemaps', '仅显示星标代码地图'],
		['from recent activity', '根据最近活动'],

		// ========== 设置菜单 ==========
		['Windsurf Settings', 'Windsurf 设置'],
		['Windsurf Usage', 'Windsurf 用量'],
		['Quick Settings Panel', '快捷设置面板'],
		['Windsurf Account', 'Windsurf 账户'],
		// 'Docs' 不做静态翻译，避免误翻文件夹名（Docs 是常见目录名）
		['Join the Community', '加入社区'],
		['Changelog', '更新日志'],
		['Current Workspace', '当前工作区'],
		['now', '刚刚'],

		// ========== 文件编辑操作 ==========
		['edits', '处编辑'],
		['Accept File', '接受文件'],
		['Reject File', '拒绝文件'],

		// ========== 终端操作 ==========
		['Send Terminal to Chat', '发送终端到聊天'],
		['Send to Chat', '发送到聊天'],

		// ========== 回复操作按钮 ==========
		['Copy response', '复制回复'],
		['Create a Codemap', '创建代码地图'],
		['View response statistics', '查看回复统计'],
		['Other actions', '更多操作'],
		['Duplicate cascade', '复制对话'],
		['Create snapshot', '创建快照'],

		// ========== Web 请求弹窗 ==========
		['Allow web request?', '允许 Web 请求？'],
		['Cascade wants to fetch this URL', 'Cascade 想要访问此 URL'],
		['Allow Once', '允许一次'],
		['Always allow this page', '始终允许此页面'],
		['Allow all requests', '允许所有请求'],

		// ========== 回复截断 ==========
		['Cascade\'s response was cut short due to length limits.', 'Cascade 的回复因长度限制被截断。'],
		['Continue to generate the full response. This will consume the selected model\'s cost.', '继续生成完整回复。这将消耗所选模型的额度。'],
		['Continue response', '继续回复'],

		// ========== 预览/命令状态 ==========
		['Checked command status', '已检查命令状态'],
		['Running Preview:', '运行预览:'],
		['Open website preview in:', '在以下位置打开网站预览:'],
		['System Browser', '系统浏览器'],
		['In-IDE', 'IDE 内'],
		['BETA', 'BETA'],

		// ========== 超时/重试 ==========
		['This is taking a long time. Click to retry if it seems stuck.', '响应时间较长。如果卡住了，点击重试。'],
		// 'Surfing.' 已在上方 Cascade 状态文本区定义为 '驰骋中.'

		// ========== 允许/禁止列表 ==========
		['Hide Allow/Deny list', '隐藏允许/禁止列表'],
		['Show Allow/Deny list', '显示允许/禁止列表'],
		['Allow / Deny List', '允许 / 禁止列表'],
		['Allow List', '允许列表'],
		['Deny List', '禁止列表'],
		['If terminal command auto-execution is enabled, Cascade will auto-run commands in the allowlist and ask for permission for commands in the denylist, with the denylist taking precedence.', '当终端命令自动执行开启时，Cascade 会自动运行允许列表中的命令，并对禁止列表中的命令请求权限，禁止列表优先。'],
		['If terminal command auto-execution is disabled, Cascade will ask for permission for all commands.', '当终端命令自动执行关闭时，Cascade 会对所有命令请求权限。'],
		['Add " *" at the end of a command for prefix matching (e.g., "git *" matches all git commands).', '在命令末尾添加 " *" 进行前缀匹配（例如 "git *" 匹配所有 git 命令）。'],

		// ========== DeepWiki ==========
		// ========== 智能体/模型切换 ==========
		['Send the task to a single model', '发送任务到单个模型'],
		['Select multiple models to compare', '选择多个模型进行对比'],
		// 智能体/模型名称不翻译，保留原始标识
		// ['Devin Local', 'Devin 本地'],  // 移除
		['Describe your task to Devin', '向 Devin 描述你的任务'],
		['Switch agent location', '切换智能体位置'],
		['Switch agent', '切换智能体'],
		['See more', '查看更多'],
		['Model provider unreachable', '模型提供商不可达'],
		['Purchase extra usage to continue using premium models', '购买额外用量以继续使用高级模型'],
		['Your included weekly usage quota is exhausted.', '您的每周配额已用完。'],
		['Your included weekly usage quota is exhausted', '您的每周配额已用完'],
		['Devin AI coding agent via Devin for Terminal', 'Devin AI 编程智能体，通过 Devin for Terminal'],
		// ['Devin Cloud', 'Devin 云端'],  // 移除：保留原始模型名
		['Cannot switch agents during an active session', '无法在活动会话期间切换智能体'],
		['Cannot switch modes after cascade has started', '无法在 Cascade 开始后切换模式'],
		['Reasoning Effort', '推理强度'],
		['Prompt cache has expired.', '提示缓存已过期。'],
		['Prompt cache has expired', '提示缓存已过期'],
		['Higher cost expected.', '预计费用更高。'],
		['Higher cost expected', '预计费用更高'],
		['Install Update', '安装更新'],
		['Your modified files:', '你修改的文件：'],
		['Your modified files', '你修改的文件'],
		['Auto-fix', '自动修复'],
		['Auto-continued', '自动继续'],

		['DeepWiki', 'DeepWiki'],
		['Welcome to DeepWiki', '欢迎使用 DeepWiki'],
		['Right-click on a symbol and select', '右键点击符号并选择'],
		['"See Wiki"', '"查看 Wiki"'],
		['to explore its definition, usage, and documentation.', '以查看其定义、用法和文档。'],
	]);
	
	const REGEX_TRANSLATIONS = [
		[/^for\s+(\d+)s$/i, '耗时 $1 秒'],
		[/^(\d+)\s+tasks$/i, '$1 个任务'],
		[/^(\d+)\s+chunks$/i, '$1 个分片'],
		[/^Failed to fetch document content at$/i, '无法获取文档内容：'],
		[/^Quota resets daily\/weekly\.\s*Plan ends in (\d+) days$/i, '配额每日/每周重置。套餐剩余 $1 天'],
		[/^Quota resets daily\/weekly$/i, '配额每日/每周重置'],
		[/^Plan ends in (\d+) days\s*\((.+)\)$/i, '套餐剩余 $1 天 ($2)'],
		[/^These settings only apply to Devin for Terminal and are saved to\s*(.+)$/i, '这些设置仅适用于 Devin 终端，并保存到 $1'],
		[/^Resets\s+(.+)$/i, '重置于 $1'],
		[/^(\d+)K context$/i, '$1K 上下文'],
		[/^\$([0-9.]+)\s*\/\s*1M tokens$/i, '$$$1 / 百万 tokens'],
		[/^(\d+)\s+tools$/i, '$1 个工具'],
		[/^(\d+)\s*\/\s*(\d+)\s+tools$/i, '$1 / $2 个工具'],
		[/^Switch mode\s*\((.+)\)$/i, '切换模式 ($1)'],
		[/^Queue\s*\((.+)\)$/i, '排队发送 ($1)'],
		[/^Send now\s*\((.+)\)$/i, '立即发送 ($1)'],
		[/^Send now\s+(.+)$/i, '立即发送 $1'],
		[/^Ask anything\s*\((.+)\)$/i, '询问任何问题 ($1)'],
		[/^(\d+)\s+resources$/i, '$1 个资源'],
		[/^Start a New Conversation\s+(.+)$/i, '开始新对话 $1'],
		[/^Start recording\s*\((.+)\)$/i, '开始录音 ($1)'],
		[/^Add Context\s*\((.+)\)$/i, '添加上下文 ($1)'],
		[/^Model Selector\s*\((.+)\)$/i, '模型选择 ($1)'],
		[/^Past Conversations\s*\((.+)\)$/i, '历史对话 ($1)'],
		[/^Search all models\s*\((.+)\)$/i, '搜索所有模型 ($1)'],
		[/^(\d+)m ago$/i, '$1 分钟前'],
		[/^(\d+)h ago$/i, '$1 小时前'],
		[/^(\d+)d ago$/i, '$1 天前'],
		[/^(\d+)s ago$/i, '$1 秒前'],
		[/^(\d+)\s+files$/i, '$1 个文件'],
		[/^(\d+)\s+MCP servers?$/i, '$1 个 MCP 服务器'],
		[/^Rename\s+(\d+)\s+files?\s+(\d+)$/i, '重命名 $1 个文件 $2'],
		[/^Daily:\s*(\d+)%\s*quota used\s*[·\-]\s*Weekly:\s*(\d+)%\s*quota used$/i, '日配额已用 $1% · 周配额已用 $2%'],
		[/^Daily:\s*(\d+)%\s*quota used$/i, '日配额已用 $1%'],
		[/^Weekly:\s*(\d+)%\s*quota used$/i, '周配额已用 $1%'],
		[/^(\d+)%\s*quota used$/i, '配额已用 $1%'],
		[/^(\d+)\s+files with changes$/i, '$1 个文件有变更'],
		[/^(\d+)\s+files?\s+(\+\d+)\s+(-\d+)$/i, '$1 个文件 $2 $3'],
		[/^Prompt cache expires in\s+(.+)$/i, '提示缓存 $1 后过期'],
		[/^Send\s*\((.+)\)$/i, '发送 ($1)'],
		[/^(\d+)\s+messages?\s+queued$/i, '$1 条消息排队中'],
		[/^Enter to send queued message\s*\((.+)\)$/i, '按回车发送排队消息 ($1)'],
		[/^(\d+)\s*\/\s*(\d+)\s+tasks?\s+done$/i, '$1 / $2 个任务完成'],
		[/^(\d+)\s+tasks?\s+done$/i, '$1 个任务完成'],
		[/^(\d+)\s+more$/i, '还有 $1 项'],
		[/^Analyzed\s+(.+)$/i, '已分析 $1'],
		[/^Read\s+(.+)$/i, '读取 $1'],
		[/^You['\u2019]ve used\s+(\d+)%\s+of your quota\.?\s*Quota resets\s+(.+)$/i, '已使用 $1% 的配额。配额重置于 $2'],
		[/^You['\u2019]ve used\s+(\d+)%\s+of your quota$/i, '已使用 $1% 的配额'],
		[/^Quota resets\s+(.+)$/i, '配额重置于 $1'],
		[/^Your included daily usage quota is exhausted\.\s*(.+?)\s+to continue using premium models\.\s*(.+)$/i, '您的每日配额已用完。$1以继续使用高级模型。$2'],
		[/^Enter a starting point for a new codemap\s*\((.+)\)$/i, '输入新代码地图的起点 ($1)'],
		[/^Enter a starting point for a new codemap$/i, '输入新代码地图的起点'],
		[/^Windsurf Account\s*\((.+)\)$/i, 'Windsurf 账户 ($1)'],
		[/^(\d+)\s+edits?$/i, '$1 处编辑'],
		[/^Accept File\s+(.+)$/i, '接受文件 $1'],
		[/^Reject File\s+(.+)$/i, '拒绝文件 $1'],
		[/^Send Terminal to Chat\s*\((.+)\)$/i, '发送终端到聊天 ($1)'],
		[/^Cancel\s*\((.+)\)$/i, '取消 ($1)'],
		[/^Prompt cache expires in\s+(\d+:\d+)$/i, '提示缓存过期于 $1'],
		[/^Invalid argument:\s*an internal error occurred\s*\(trace ID:\s*([^)]+)\)$/i, '参数无效：发生内部错误（跟踪 ID：$1）'],
		[/^Permission denied:\s*all API providers are over their global rate limit for trial users\s*\(trace ID:\s*([^)]+)\)$/i, '权限拒绝：所有 API 提供商已达到试用用户的全局速率限制（跟踪 ID：$1）'],
		[/^Permission denied:\s*all API providers are over their global rate limit for trial users$/i, '权限拒绝：所有 API 提供商已达到试用用户的全局速率限制'],
		[/^Permission denied:\s*(.+?)\s*\(trace ID:\s*([^)]+)\)$/i, '权限拒绝：$1（跟踪 ID：$2）'],
		[/^Failed precondition:\s*(.+?)\s*\(trace ID:\s*([^)]+)\)$/i, '前置条件失败：$1（跟踪 ID：$2）'],
		[/^Resource exhausted:\s*(.+?)\s*\(trace ID:\s*([^)]+)\)$/i, '资源耗尽：$1（跟踪 ID：$2）'],
		[/^Internal error:\s*(.+?)\s*\(trace ID:\s*([^)]+)\)$/i, '内部错误：$1（跟踪 ID：$2）'],
		// 社区高频错误翻译
		[/^Deadline exceeded:\s*Encountered retryable error from model provider:\s*context deadline exceeded\s*\(Client\.Timeout or context cancellation while reading body\)$/i, '响应超时：模型提供商响应过慢被中断（流式读取超时）'],
		[/^Deadline exceeded:\s*(.+)$/i, '超时：$1'],
		[/^Cascade has encountered an internal error in this step\.\s*No credits consumed on this tool call\.$/i, 'Cascade 在此步骤遇到内部错误。本次工具调用未消耗额度。'],
		[/^Cascade has encountered an internal error in this step\.?$/i, 'Cascade 在此步骤遇到内部错误。'],
		[/^Encountered unexpected error during\s+(.+)$/i, '在 $1 期间遇到未预期错误'],
		[/^This request is taking longer than expected\.?$/i, '此请求耗时超出预期'],
		[/^Failed to log in:\s*\[deadline_exceeded\]\s*deadline_exceeded$/i, '登录失败：[超时] 登录态已失效'],
		[/^Cascade can make up to (\d+) tool calls per prompt\.?$/i, 'Cascade 每次提示最多可调用 $1 次工具'],
		[/^context length exceeded$/i, '上下文长度超限'],
		[/^prompt is too long$/i, '提示词过长'],
		[/^maximum context length\s*(.*)$/i, '已达最大上下文长度 $1'],
		[/^Send the task to a single model\s*\((.+)\)$/i, '发送任务到单个模型 ($1)'],
		[/^Select multiple models to compare\s*\((.+)\)$/i, '选择多个模型进行对比 ($1)'],
		[/^Switch agent location\s*\((.+)\)$/i, '切换智能体位置 ($1)'],
		[/^Switch agent\s*\((.+)\)$/i, '切换智能体 ($1)'],
		[/^Describe your task to Devin$/i, '向 Devin 描述你的任务'],
		[/^Invalid argument:\s*The third-party model provider is experiencing issues and is currently not available\.\s*Please try this model again later\.\s*\(trace ID:\s*([^)]+?)\)?\.?$/i, '参数无效：第三方模型提供商出现问题，当前不可用。请稍后重试此模型。（跟踪 ID：$1）'],
		[/^Invalid argument:\s*The third-party model provider is experiencing issues and is currently not available\.\s*Please try this model again later\.?$/i, '参数无效：第三方模型提供商出现问题，当前不可用。请稍后重试此模型。'],
		[/^Model provider unreachable$/i, '模型提供商不可达'],
		[/^Reached message rate limit for this model\.\s*Please try again later\.\s*Resets in:\s*(.+?)\s*$/i, '此模型已达到消息速率限制。请稍后再试。重置时间：$1'],
		[/^Reached message rate limit for this model\.\s*Please try again later\.?$/i, '此模型已达到消息速率限制，请稍后再试。'],
		[/^Purchase extra usage to continue using premium models\s*\u2192?$/i, '购买额外用量以继续使用高级模型 →'],
		[/^Cannot switch agents during an active session\s*\((.+)\)$/i, '无法在活动会话期间切换智能体 ($1)'],
		[/^Plan ends in (\d+) days?$/i, '套餐剩余 $1 天'],
		[/^(\d+)%\s*\(([^)]+)\)\s*context used$/i, '$1% ($2) 上下文已用'],
		[/^\(([^)]+)\)\s*context used$/i, '($1) 上下文已用'],
		[/^([\d.]+[KMB]?)\s*\/\s*([\d.]+[KMB]?)\s*context used$/i, '$1 / $2 上下文已用'],
		[/^([\d.]+[KMB]?)\s*context used$/i, '$1 上下文已用'],
	];

	// ========== 软翻译（子串替换）==========
	// 用于 DOM 文本节点被拆分（多个 <span>）导致整条锚定正则失败时的兜底
	// 仅替换关键短语，不依赖整文本匹配。注意：不要包含过短/过通用的英文词，避免误伤代码、文件名等
	const SOFT_TRANSLATIONS = [
		// 上下文使用量
		[/\bcontext used\b/gi, '上下文已用'],
		[/\bcontext window used\b/gi, '上下文窗口已用'],
		[/\bof context used\b/gi, '上下文已用'],
		[/\bquota used\b/gi, '配额已用'],
		[/\bquota remaining\b/gi, '剩余配额'],
		[/\bquota exhausted\b/gi, '配额已耗尽'],
		[/\bdaily quota\b/gi, '每日配额'],
		[/\bweekly quota\b/gi, '每周配额'],
		[/\busage limit\b/gi, '使用上限'],
		[/\busage exceeded\b/gi, '使用量已超限'],
		// 完整短语优先（更具体的放前面）
		[/\bYour included weekly usage quota is exhausted\.?/gi, '你的每周用量配额已耗尽。'],
		[/\bYour included daily usage quota is exhausted\.?/gi, '你的每日用量配额已耗尽。'],
		[/\bYour included usage quota is exhausted\.?/gi, '你的包含用量配额已耗尽。'],
		[/\bweekly usage quota is exhausted\b/gi, '每周用量配额已耗尽'],
		[/\bdaily usage quota is exhausted\b/gi, '每日用量配额已耗尽'],
		[/\busage quota is exhausted\b/gi, '用量配额已耗尽'],
		[/\bincluded usage\b/gi, '包含用量'],
		// 配额提示（与额度耗尽相关，常被拆分）
		[/\bof your quota\b/gi, '你的配额'],
		// 注意：更具体的 "Quota resets daily/weekly" 整体短语优先于裸 "Quota resets"
		[/\bQuota resets daily\/weekly\b/gi, '配额每日/每周重置'],
		[/\bQuota resets daily\b/gi, '配额每日重置'],
		[/\bQuota resets weekly\b/gi, '配额每周重置'],
		[/\bQuota will reset (?:in|at|on)\b/gi, '配额重置于'],
		[/\bQuota resets (?:in|at|on)\b/gi, '配额重置于'],
		[/\bResets in:\s*/gi, '重置时间：'],
		[/\bResets at\b/gi, '重置于'],
		// Plan 到期（拆分场景，无锚定）
		[/\bPlan ends in (\d+) days?\b/gi, '套餐剩余 $1 天'],
		[/\bdaily\/weekly\b/gi, '每日/每周'],
		[/\bdaily\b/gi, '每日'],
		[/\bweekly\b/gi, '每周'],
		[/\b(\d+)\s*days?\b/gi, '$1 天'],
		// 速率限制相关
		[/\bPlease try again later\.?/gi, '请稍后再试。'],
		[/\bPlease try again\.?/gi, '请重试。'],
		[/\bRate limit exceeded\b/gi, '速率限制超出'],
		// 用量预警
		[/\bUsage is high\b/gi, '使用量较高'],
		[/\bUsage warning\b/gi, '用量预警'],
		[/\ball providers? (?:are )?(?:exhausted|over capacity)\b/gi, '所有提供商均已耗尽'],
		// 状态/动作短语
		[/\bGenerating\b/gi, '生成中'],
		// [/\bThinking\b/gi, '思考中'],  // 移除：避免误翻模型限定词
		[/\bSearching\b/gi, '搜索中'],
		[/\bLoading\b/gi, '加载中'],
		[/\bConnecting\b/gi, '连接中'],
		[/\bRetrying\b/gi, '重试中'],
		[/\bWaiting\b/gi, '等待中'],
	];

	function applySoftReplacement(s) {
		let out = s;
		let changed = false;
		for (const [re, rep] of SOFT_TRANSLATIONS) {
			if (re.test(out)) {
				re.lastIndex = 0; // 重置 g 标志位
				out = out.replace(re, rep);
				changed = true;
			}
			re.lastIndex = 0;
		}
		return changed ? out : null;
	}
	
	function logLocalization(...args) { console.log(LOG_PREFIX + '[Localization]', ...args); }
	
	// 大小写不敏感的查找索引（小写键 -> 原始键），按需懒构建
	let _translationsLowerIndex = null;
	function getTranslationsLowerIndex() {
		if (_translationsLowerIndex) return _translationsLowerIndex;
		_translationsLowerIndex = new Map();
		for (const k of TRANSLATIONS.keys()) {
			const lk = k.toLowerCase();
			if (!_translationsLowerIndex.has(lk)) _translationsLowerIndex.set(lk, k);
		}
		return _translationsLowerIndex;
	}

	// 拆分尾部标点：返回 [核心, 尾部标点]
	// 尾部包含: . … ... : ; ! ? 。 ， ： ； ！ ？ 以及尖括号箭头 → ▸ ▾ 等装饰符（连同前置空白）
	const TRAILING_PUNCT_RE = /[\s\u00A0]*([.\u2026:;!?\u3002\uFF1A\uFF1B\uFF01\uFF1F]+|\.\.\.|[\u2192\u25B8\u25BE\u25BC])$/;
	function splitTrailingPunct(s) {
		const m = s.match(TRAILING_PUNCT_RE);
		if (!m) return [s, ''];
		return [s.slice(0, m.index), m[0]];
	}

	// 归一化内部空白（多空格、NBSP、零宽空格）
	function normalizeWhitespace(s) {
		return s
			.replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
			.replace(/\u00A0/g, ' ')
			.replace(/\s+/g, ' ');
	}

	// 标点尾部的中文化映射
	const PUNCT_CN_MAP = { '.': '。', ':': '：', ';': '；', '!': '！', '?': '？' };
	function localizePunct(p) {
		// 仅当尾部为单个 ASCII 标点时本地化；多字符（如 ... → 和组合符）原样返回
		if (p && p.length === 1 && PUNCT_CN_MAP[p]) return PUNCT_CN_MAP[p];
		// 处理 "..." -> "…"
		if (/^\.{3,}$/.test(p.trim())) return '…';
		return p;
	}

	function lookupTranslation(core) {
		// 1) 精确
		if (TRANSLATIONS.has(core)) return TRANSLATIONS.get(core);
		// 2) 大小写不敏感
		const idx = getTranslationsLowerIndex();
		const orig = idx.get(core.toLowerCase());
		if (orig) return TRANSLATIONS.get(orig);
		return null;
	}

	function applyRegex(core) {
		for (const [pattern, replacement] of REGEX_TRANSLATIONS) {
			if (pattern.test(core)) return core.replace(pattern, replacement);
		}
		return null;
	}

	function translateText(text) {
		if (!text || !text.trim()) return text;
		const leading = text.match(/^\s*/)?.[0] ?? '';
		const trailing = text.match(/\s*$/)?.[0] ?? '';
		let core = text.trim();

		// 跳过模型名标签（如 "Claude Opus 4.6 Thinking", "SWE-1.6 Fast"）
		// 短于 80 字符且包含已知模型标识 → 认为是模型标签，不翻译
		// 但含描述性词汇（for/via/agent 等）时例外，视为描述文字继续翻译
		if (core.length < 80 && MODEL_LABEL_SKIP_RE.test(core) && !MODEL_DESC_RE.test(core)) return text;

		// 第 1 轮：原文精确/大小写不敏感
		let hit = lookupTranslation(core);
		if (hit) return `${leading}${hit}${trailing}`;

		// 第 2 轮：归一化空白后查找
		const normalized = normalizeWhitespace(core);
		if (normalized !== core) {
			hit = lookupTranslation(normalized);
			if (hit) return `${leading}${hit}${trailing}`;
		}

		// 第 3 轮：剥离尾部标点后再查
		const [stripped, tail] = splitTrailingPunct(normalized);
		if (tail && stripped) {
			hit = lookupTranslation(stripped);
			if (hit) return `${leading}${hit}${localizePunct(tail)}${trailing}`;
		}

		// 第 4 轮：正则匹配（原文）
		let regHit = applyRegex(core);
		if (regHit) return `${leading}${regHit}${trailing}`;

		// 第 5 轮：正则匹配（归一化后）
		if (normalized !== core) {
			regHit = applyRegex(normalized);
			if (regHit) return `${leading}${regHit}${trailing}`;
		}

		// 第 6 轮：正则匹配（剥离尾部标点后）
		if (tail && stripped) {
			regHit = applyRegex(stripped);
			if (regHit) return `${leading}${regHit}${localizePunct(tail)}${trailing}`;
		}

		// 第 7 轮：软翻译子串替换（兜底，处理 DOM 拆分文本节点导致的半汉化）
		const softHit = applySoftReplacement(core);
		if (softHit) return `${leading}${softHit}${trailing}`;

		return text;
	}
	
	function shouldSkip(node) {
		if (!node) return true;
		if (node.nodeType === Node.ELEMENT_NODE) {
			return Boolean(node.closest(EXCLUDE_SELECTOR));
		}
		const parent = node.parentElement;
		return !parent || Boolean(parent.closest(EXCLUDE_SELECTOR));
	}
	
	function translateAttributes(el) {
		if (!el || shouldSkip(el)) return;
		for (const attr of ATTRS_TO_TRANSLATE) {
			const value = el.getAttribute(attr);
			if (!value) continue;
			// 已翻译过的 attribute 不再处理（避免重复翻译破坏原值）
			if (el.hasAttribute('data-ws-orig-' + attr)) continue;
			const translated = translateText(value);
			if (translated !== value) {
				// 先存原值，再写翻译值，便于关闭汉化时还原
				el.setAttribute('data-ws-orig-' + attr, value);
				el.setAttribute(attr, translated);
			}
		}
	}
	
	// 翻译过的 textNode → 原文映射（用于关闭汉化时实时还原）
	// WeakMap 不阻止 GC，textNode 被移除后自动回收
	const _translatedTextNodes = new WeakMap();
	// 翻译过的 attribute → 原值（attr key: el + ':' + attr，存到 dataset）
	// 简化：每个被翻译的 attribute 在元素上记录 data-ws-orig-<attr>="<原值>"

	function translateTextNode(node) {
		if (!node || shouldSkip(node)) return;
		const original = node.nodeValue;
		const translated = translateText(original);
		if (translated !== original) {
			node.nodeValue = translated;
			// 1) 单 textNode 原文存 WeakMap，关闭汉化时精确还原
			_translatedTextNodes.set(node, original);
			// 2) 同时把原文写到父元素 data-ws-orig（供错误检测等模块用）
			try {
				const parent = node.parentElement;
				if (parent && original && original.trim()) {
					const prev = parent.getAttribute('data-ws-orig') || '';
					if (!prev.includes(original)) {
						parent.setAttribute('data-ws-orig', prev ? prev + '\n' + original : original);
					}
				}
			} catch {}
		}
	}

	/** 还原汉化：遍历整个 document 找回所有翻译过的 textNode 还原回原文 */
	function revertLocalization() {
		// 1) 还原 textNode
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let cur = walker.nextNode();
		let count = 0;
		while (cur) {
			const orig = _translatedTextNodes.get(cur);
			if (orig != null && orig !== cur.nodeValue) {
				cur.nodeValue = orig;
				count++;
			}
			cur = walker.nextNode();
		}
		// 2) 还原 attributes（从 data-ws-orig-<attr> 取回原值）
		document.querySelectorAll('*').forEach(el => {
			for (const attr of ATTRS_TO_TRANSLATE) {
				const stored = el.getAttribute('data-ws-orig-' + attr);
				if (stored != null) {
					el.setAttribute(attr, stored);
					el.removeAttribute('data-ws-orig-' + attr);
				}
			}
		});
		// 3) 还原彩虹文本元素
		document.querySelectorAll('[data-ws-rainbow]').forEach(el => {
			setSafeHTML(el, el.getAttribute('data-ws-rainbow'));
			el.removeAttribute('data-ws-rainbow');
			count++;
		});
		// 4) 清理 data-ws-orig 标记（错误检测改读 textContent）
		document.querySelectorAll('[data-ws-orig]').forEach(el => el.removeAttribute('data-ws-orig'));
		console.log(LOG_PREFIX + '[Localization] 已还原 ' + count + ' 个 textNode');
	}
	
	function scanAndTranslate(root) {
		if (!root || !settings.localizationEnabled) return;
		if (root.nodeType === Node.TEXT_NODE) {
			// 节点已脱离 DOM 则跳过
			if (!root.parentNode || !root.parentNode.isConnected) return;
			translateTextNode(root);
			return;
		}
		
		const elementRoot = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
		if (!elementRoot || !elementRoot.isConnected) return;
		// 整个 root 在排除区域内（如 Monaco 编辑器）→ 跳过整棵子树
		if (elementRoot.closest && elementRoot.closest(EXCLUDE_SELECTOR)) return;
		
		translateAttributes(elementRoot);
		const elementList = elementRoot.querySelectorAll ? elementRoot.querySelectorAll('*') : [];
		for (const el of elementList) {
			translateAttributes(el);
		}
		
		const walker = document.createTreeWalker(elementRoot, NodeFilter.SHOW_TEXT);
		let current = walker.nextNode();
		while (current) {
			translateTextNode(current);
			current = walker.nextNode();
		}

		// ========== 彩虹文本合并翻译 ==========
		// 处理每个字符被单独 <span> 包裹（渐变/彩虹色）的情况：
		// 单个 textNode 只含 1-2 个字符，无法匹配完整翻译键。
		// 策略：找到 childNodes 全为内联元素且各含极短文本的父元素，
		// 拼合 textContent 后查翻译表，命中则整体替换。
		translateRainbowElements(elementRoot);
	}

	/** 检测并翻译"彩虹文本"（字符被拆分到多个 span 的元素） */
	function translateRainbowElements(root) {
		if (!root || !root.querySelectorAll) return;
		// 候选：含多个子元素、textContent 长度适中的元素
		const candidates = root.querySelectorAll('span, p, h1, h2, h3, h4, h5, h6, div, label, a, button');
		for (const el of candidates) {
			if (shouldSkip(el)) continue;
			// 已处理过则跳过
			if (el.hasAttribute('data-ws-rainbow')) continue;
			const children = el.childNodes;
			// 至少 3 个子节点且大部分是 element（span）
			if (children.length < 3) continue;
			let spanCount = 0;
			let totalTextLen = 0;
			for (const ch of children) {
				if (ch.nodeType === Node.ELEMENT_NODE && ch.tagName === 'SPAN') {
					spanCount++;
					totalTextLen += (ch.textContent || '').length;
				} else if (ch.nodeType === Node.TEXT_NODE) {
					totalTextLen += (ch.nodeValue || '').length;
				}
			}
			// 判定为彩虹文本：大部分子节点是 span 且平均每个 span 文本很短
			if (spanCount < 3 || spanCount / children.length < 0.6) continue;
			if (totalTextLen / spanCount > 3) continue; // 平均每 span 超过 3 字符则不是逐字拆分

			const combined = el.textContent.trim();
			if (!combined || combined.length > 200) continue;
			const translated = translateText(combined);
			if (translated && translated !== combined) {
				// 记录原始 HTML 用于还原
				el.setAttribute('data-ws-rainbow', el.innerHTML);
				el.textContent = translated;
			}
		}
	}
	
	let pendingRoots = new Set();
	let _locFlushTimer = 0;
	let _isTranslating = false;
	let localizationObserver = null;
	// 短 debounce：让快速连续 DOM 变更（切换聊天）合并为一次翻译
	// 60ms 足够让 React reconciliation 完成，又不会产生明显闪烁
	const LOC_DEBOUNCE_MS = 60;
	
	function flushQueue() {
		_locFlushTimer = 0;
		if (!settings.localizationEnabled) return;
		_isTranslating = true;
		try {
			for (const root of pendingRoots) {
				// 跳过已从 DOM 中移除的节点（切换聊天时旧节点被卸载）
				if (root && root.nodeType === Node.ELEMENT_NODE && !root.isConnected) continue;
				if (root && root.nodeType === Node.TEXT_NODE && (!root.parentNode || !root.parentNode.isConnected)) continue;
				scanAndTranslate(root);
			}
		} finally {
			_isTranslating = false;
			// 消耗掉由翻译自身产生的 mutations，断掉反馈环
			if (localizationObserver) localizationObserver.takeRecords();
		}
		pendingRoots.clear();
	}
	
	function enqueue(root) {
		pendingRoots.add(root || document.body);
		if (_locFlushTimer) clearTimeout(_locFlushTimer);
		_locFlushTimer = setTimeout(flushQueue, LOC_DEBOUNCE_MS);
	}
	
	function startLocalizationObserver() {
		if (localizationObserver) localizationObserver.disconnect();
		localizationObserver = new MutationObserver((mutations) => {
			// 忽略自身翻译产生的 mutations（断掉 translate→observe→translate 反馈环）
			if (_isTranslating) return;
			for (const mutation of mutations) {
				if (mutation.type === 'characterData') {
					enqueue(mutation.target);
					continue;
				}
				if (mutation.type === 'attributes') {
					enqueue(mutation.target);
					continue;
				}
				for (const node of mutation.addedNodes) {
					enqueue(node);
				}
			}
		});
		
		localizationObserver.observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ATTRS_TO_TRANSLATE,
		});
	}
	
	// (Settings UI removed — moved to sidebar panel)
	
	// ========== 自动操作统计 ==========
	const _acStats = { continueBtn: 0, sendMsg: 0, retry: 0, switchAcct: 0, switchModel: 0, permission: 0, dismiss: 0, _startTs: Date.now() };
	let _acStatsPushTimer = null;
	function pushAcStats() {
		// 节流：50ms 内多次 bump 只推一次
		if (_acStatsPushTimer) return;
		_acStatsPushTimer = setTimeout(() => {
			_acStatsPushTimer = null;
			try {
				if (typeof bridgePostResult === 'function' && typeof getBridgeUrl === 'function' && getBridgeUrl()) {
					bridgePostResult({ action: 'ac-stats', stats: { ..._acStats } });
				}
			} catch {}
		}, 50);
	}
	function bumpAcStat(key) { _acStats[key] = (_acStats[key] || 0) + 1; pushAcStats(); }

	// ========== 自动继续 ==========
	let autoContinueObserver = null;
	let _autoContinueDebounceTimer = null;
	let _autoContinueLastFireTs = 0;
	function startAutoContinue() {
		if (autoContinueObserver) { autoContinueObserver.disconnect(); autoContinueObserver = null; }
		if (settings.continueMode !== 'smart') return;
		// 守护面板「自动续写」开关关闭时不启动
		if (settings.guardian && settings.guardian.autoContinueButton === false) return;
		const tryClick = () => {
			if (settings.continueMode !== 'smart') return;
			if (settings.guardian && settings.guardian.autoContinueButton === false) return;
			// 与 recovery 模块共用冷却，避免重复点击同一按钮
			if (typeof isInCooldown === 'function' && isInCooldown()) return;
			// 自身 5s 冷却，避免短时间内被 MutationObserver 反复触发
			if (Date.now() - _autoContinueLastFireTs < 5000) return;
			// 限定在聊天根内查找，避免误点侧栏内的同名按钮
			const scope = findChatRoot() || document;
			const btns = scope.querySelectorAll('button, [role="button"]');
			for (const btn of btns) {
				const txt = (btn.textContent || '').trim();
				if (txt === 'Continue response' || txt === '继续回复') {
					if (typeof isVisibleAndClickable === 'function' && !isVisibleAndClickable(btn)) continue;
					_autoContinueLastFireTs = Date.now();
					if (typeof markActionClick === 'function') markActionClick();
					bumpAcStat('continueBtn');
					console.log(LOG_PREFIX + '[AutoContinue] 检测到截断，自动继续...');
					setTimeout(() => btn.click(), 800);
					return;
				}
			}
		};
		// 200ms 防抖：AI 边生成边变 DOM，每次都 querySelectorAll 太耗性能
		autoContinueObserver = new MutationObserver(() => {
			if (settings.continueMode !== 'smart') return;
			if (_autoContinueDebounceTimer) clearTimeout(_autoContinueDebounceTimer);
			_autoContinueDebounceTimer = setTimeout(tryClick, 200);
		});
		autoContinueObserver.observe(document.body, { childList: true, subtree: true });
		console.log(LOG_PREFIX + '[AutoContinue] ✅已启用（防抖 200ms）');
	}

	let dismissCorruptObserver = null;
	function dismissCorruptWarning() {
		if (dismissCorruptObserver) { dismissCorruptObserver.disconnect(); dismissCorruptObserver = null; }
		if (!settings.dismissCorruptEnabled) return;
		const kw = ['corrupt', 'reinstall', '损坏', '重新安装'];
		function tryD() {
			if (!settings.dismissCorruptEnabled) return;
			document.querySelectorAll('.notification-toast,.notifications-toasts .notification-list-item').forEach(t => {
				const x = (t.textContent || '').toLowerCase();
				if (kw.some(k => x.includes(k))) {
					const c = t.querySelector('.codicon-notifications-clear,.codicon-close,.action-label[title*="Close"],.action-label[title*="关闭"]');
					if (c) { c.click(); logLocalization('✅关闭损坏通知'); bumpAcStat('dismiss'); }
					else { t.style.display = 'none'; logLocalization('✅隐藏损坏通知'); bumpAcStat('dismiss'); }
				}
			});
		}
		// 防抖：避免每次 DOM 变化都扫描全部通知
		let debounceTimer = null;
		dismissCorruptObserver = new MutationObserver(() => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(tryD, 300);
		});
		dismissCorruptObserver.observe(document.body, { childList: true, subtree: true });
		setTimeout(tryD, 2000);
	}

	// ========== 自动恢复（AutoRecovery） ==========

	// ── 错误模式分类表 ──
	// 每条: { pattern, category, signal?, hint? }
	// category: networkErrors | quotaErrors | modelErrors | continuationErrors | permissionRequests | userIntervention
	const ERROR_PATTERNS = [
		// ── 网络超时 / 临时故障 ──
		{ pattern: /Model provider unreachable/i,                              category: 'networkErrors' },
		{ pattern: /an internal error occurred/i,                              category: 'networkErrors' },
		{ pattern: /retryable error from model provider/i,                     category: 'networkErrors' },
		{ pattern: /API provider is overloaded\.\s*Please try again/i,         category: 'networkErrors' },
		{ pattern: /This is taking a long time/i,                              category: 'networkErrors' },
		{ pattern: /Deadline exceeded:.*context deadline exceeded/i,            category: 'networkErrors' },
		{ pattern: /context deadline exceeded/i,                               category: 'networkErrors' },
		{ pattern: /Client\.Timeout or context cancellation/i,                 category: 'networkErrors' },
		{ pattern: /Cascade has encountered an internal error in this step/i,  category: 'networkErrors' },
		{ pattern: /No credits consumed on this tool call/i,                   category: 'networkErrors' },
		{ pattern: /Encountered unexpected error during/i,                     category: 'networkErrors' },
		{ pattern: /This request is taking longer than expected/i,             category: 'networkErrors' },
		{ pattern: /stream.*was\s*(interrupted|cancelled|aborted)/i,           category: 'networkErrors' },
		{ pattern: /connection.*was\s*(reset|closed)/i,                        category: 'networkErrors' },

		// ── 配额耗尽 / 速率限制 ──
		{ pattern: /daily usage quota has been exhausted/i,                    category: 'quotaErrors', signal: 'quota-daily-exhausted' },
		{ pattern: /usage quota.*exhausted/i,                                  category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /monthly acu limit reached/i,                              category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /you have reached your.*limit/i,                           category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /reached your usage limit/i,                               category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /resource_exhausted/i,                                      category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /all API providers are over capacity/i,                     category: 'quotaErrors', signal: 'provider-overloaded' },
		{ pattern: /Failed precondition.*quota/i,                              category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /all API providers are over their global rate limit/i,      category: 'quotaErrors', signal: 'rate-limited' },
		{ pattern: /rate limit exceeded/i,                                     category: 'quotaErrors', signal: 'rate-limited' },
		{ pattern: /upgrade to a Pro account for higher limits/i,              category: 'quotaErrors', signal: 'rate-limited' },
		{ pattern: /权限拒绝.*rate limit/i,                                    category: 'quotaErrors', signal: 'rate-limited' },
		{ pattern: /权限拒绝.*全局速率限制/,                                    category: 'quotaErrors', signal: 'rate-limited' },
		{ pattern: /提供商.*全局速率限制/,                                      category: 'quotaErrors', signal: 'rate-limited' },
		{ pattern: /Reached.*(?:message|rate) limit/i,                         category: 'quotaErrors', signal: 'rate-limited' },
		{ pattern: /此模型已达到消息速率限制/i,                                category: 'quotaErrors', signal: 'rate-limited' },
		{ pattern: /已达到.*(?:配额|限制|额度)/,                               category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /额度.*(?:耗尽|用完|不足)/,                                 category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /配额.*耗尽/,                                               category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /配额.*用完/,                                               category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /用量配额已耗尽/,                                           category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /credit(?:s)?\s*(?:exhausted|depleted|exceeded|run out)/i,    category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /no credits (?:remaining|left|available)/i,                  category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /insufficient credits/i,                                    category: 'quotaErrors', signal: 'quota-exhausted' },
		{ pattern: /积分.*(?:耗尽|不足|用完)/,                                  category: 'quotaErrors', signal: 'quota-exhausted' },

		// ── HTTP 服务端错误 / 工具调用失败（走 retry / switch-model 而非切号） ──
		{ pattern: /HTTP\s*5\d{2}\b/i,                                          category: 'networkErrors' },
		{ pattern: /\bstatus\s*(?:code\s*)?5\d{2}\b/i,                         category: 'networkErrors' },
		{ pattern: /Internal Server Error/i,                                   category: 'networkErrors' },
		{ pattern: /Bad Gateway/i,                                             category: 'networkErrors' },
		{ pattern: /Service Unavailable/i,                                     category: 'networkErrors' },
		{ pattern: /Gateway Timeout/i,                                         category: 'networkErrors' },
		{ pattern: /服务器内部错误/,                                           category: 'networkErrors' },
		{ pattern: /网关(?:错误|超时)/,                                        category: 'networkErrors' },
		{ pattern: /服务不可用/,                                               category: 'networkErrors' },
		{ pattern: /tool call failed/i,                                        category: 'networkErrors' },
		{ pattern: /failed to (?:call|invoke|execute) tool/i,                  category: 'networkErrors' },
		{ pattern: /工具调用失败/,                                             category: 'networkErrors' },
		{ pattern: /failed to fetch/i,                                         category: 'networkErrors' },
		{ pattern: /network request failed/i,                                  category: 'networkErrors' },

		// ── 模型不可用（第三方提供商故障） ──
		{ pattern: /third-party model provider is experiencing issues/i,       category: 'modelErrors', signal: 'provider-unavailable' },
		{ pattern: /model provider is currently not available/i,               category: 'modelErrors', signal: 'provider-unavailable' },

		// ── 工具调用上限 / 响应截断 ──
		{ pattern: /reached.*invocation limit/i,                               category: 'continuationErrors', triggerAction: 'send-continue' },
		{ pattern: /Cascade can make up to \d+ tool calls per prompt/i,        category: 'continuationErrors', triggerAction: 'send-continue' },
		{ pattern: /maximum (?:number of )?tool calls reached/i,               category: 'continuationErrors', triggerAction: 'send-continue' },
		{ pattern: /tool call limit reached/i,                                 category: 'continuationErrors', triggerAction: 'send-continue' },

		// ── 需要用户介入 ──
		{ pattern: /Windsurf version is out of date/i,                         category: 'userIntervention', hint: '请更新 Windsurf 版本' },
		{ pattern: /Failed to log in:\s*\[deadline_exceeded\]/i,               category: 'userIntervention', hint: '登录态失效，请重新登录或重启 Windsurf' },
		{ pattern: /Authentication (?:failed|expired)/i,                       category: 'userIntervention', hint: '认证失败，请重新登录' },
		{ pattern: /unauthorized/i,                                            category: 'userIntervention', hint: '未授权，请重新登录' },
		{ pattern: /context length exceeded/i,                                 category: 'userIntervention', hint: '上下文超长，请压缩对话或新开会话' },
		{ pattern: /prompt is too long/i,                                      category: 'userIntervention', hint: '提示词过长，请精简后重试' },
		{ pattern: /maximum context length/i,                                  category: 'userIntervention', hint: '已达模型最大上下文，请新开会话' },
	];

	// 按钮触发（继续回复 / Continue response）
	const CONTINUE_BUTTON_TEXTS = ['Continue response', '继续回复'];

	// ========== 通用选择器常量（避免字面量重复） ==========
	const MODEL_SELECTOR_BTN_SEL = 'button[aria-label*="Model Selector"], button[aria-label*="模型选择"]';
	const MODEL_PANEL_SEL = '.radix-popover-content[data-state="open"], [data-radix-popper-content-wrapper] [role="dialog"], [class*="model-selector"], [class*="modelSelector"], [role="listbox"], [role="menu"]';
	const MODEL_OPTION_SEL = 'button[data-kb-navigate="true"], [role="option"], [role="menuitem"]';
	const ASSISTANT_MSG_SEL = '[data-role="assistant"], .assistant-message, [class*="assistantMessage"]';
	const USER_MSG_SEL = '[data-role="user"], .user-message, [class*="userMessage"]';
	const ERROR_BUBBLE_SEL = [
		'.error-message',
		'[data-testid="error-message"]',
		'[role="alert"]',
		'.status-message[class*="error"]',
	];
	const CONT_MSG_SEL = [
		'.error-message',
		'[data-testid="error-message"]',
		'[role="alert"]', '[role="status"]',
		'.status-message',
		'[class*="error-bubble"]', '[class*="errorBubble"]',
	];

	// 统一排除选择器：这些 DOM 区域不包含真实错误（参考星火插件 isIgnoredQuotaElement）
	const IGNORED_CONTEXT_SEL = [
		'.monaco-editor', 'pre', 'code', 'textarea', 'input', '[contenteditable="true"]',
		'.terminal', '.xterm', '[class*="terminal-"]', '[class*="xterm-"]', '.integrated-terminal',
		'.notifications-center', '.notification-toast',
		'.markers-panel', '.output-view', '.output-body',
	].join(',');

	// 限流双重确认标记：rate-limited 信号需同时命中主关键词 + 至少一个真实标记，
	// 避免 AI 讨论 "rate limit" 文字被误判（参考星火插件 RATE_LIMIT_REAL_MARKERS）
	const RATE_LIMIT_REAL_MARKERS = [
		'trace id', 'credits were used', 'request was not processed',
		'try again in about', 'upgrade to a pro account', 'add-credits',
		'please wait', 'retry after', 'too many requests',
		'permission denied', 'global rate limit', 'message rate limit',
		'over capacity', 'over their global',
		'权限拒绝', '全局速率限制', '消息速率限制',
	];

	// 获取扫描根：优先 chat root，回退到 body
	function getScanRoot() {
		return findChatRoot() || document.body;
	}

	// ── 切换模型 ──
	// Windsurf 模型选择器通过 aria-label="Model Selector" 的按钮触发
	let _modelSwitchInProgress = false;

	// 已知的模型名前缀正则（用于 fallback 识别按钮）
	const MODEL_NAME_RE = /^(claude[-\s]|gpt[-\s]?|gpt\d|o\d[-\s]|gemini|llama|qwen|deepseek|mistral|mixtral|sonnet|haiku|opus|grok|swe-)/i;

	// 找到当前模型选择器按钮（多层 fallback，同时搜索主文档和 Cascade iframe）
	function findModelSelectorBtn() {
		const chatRoot = findChatRoot();
		const scopes = chatRoot ? [chatRoot, document] : [document];

		for (const scope of scopes) {
			// 1. aria-label 精确匹配
			let btn = scope.querySelector(MODEL_SELECTOR_BTN_SEL);
			if (btn) return btn;
			// 2. data-testid / data-test 含 model
			btn = scope.querySelector('[data-testid*="model" i], [data-test*="model" i]');
			if (btn) return btn;
		}
		for (const scope of scopes) {
			// 3. 类名含 "model" + "select"
			const candidates = scope.querySelectorAll(
				'[class*="model" i][class*="select" i], [class*="modelSelector" i], [class*="model-selector" i]'
			);
			for (const c of candidates) {
				const text = (c.textContent || '').trim();
				if (text && text.length < 120) return c;
			}
		}
		for (const scope of scopes) {
			// 4. 扫描可点击元素，逐行检查文本是否匹配模型名
			const clickables = scope.querySelectorAll(
				'button, [role="button"], [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], [aria-haspopup="true"], [class*="model" i]'
			);
			let best = null;
			let bestLen = Infinity;
			for (const c of clickables) {
				const t = (c.textContent || '').trim();
				if (!t || t.length > 120) continue;
				// 检查完整文本和每一行（按钮可能包含多行，如 "代码\nClaude Opus 4.7"）
				const lines = [t, ...t.split(/\n/).map(l => l.trim()).filter(Boolean)];
				for (const line of lines) {
					if (line.length > 60) continue;
					if (MODEL_NAME_RE.test(line) && line.length < bestLen) {
						best = c;
						bestLen = line.length;
						break;
					}
				}
			}
			if (best) return best;
		}
		return null;
	}

	// 全文档扫描所有按钮 / 选项 / 列表项的文本，挑出符合模型名前缀的
	// 用作"找不到模型选择器"或"面板没出现"时的兜底
	function scanPageForModelNames() {
		const found = new Set();
		const all = document.querySelectorAll(
			'button, [role="button"], [role="menuitem"], [role="option"], [data-value], [class*="option"], [class*="item"]'
		);
		for (const el of all) {
			const t = (el.textContent || '').trim();
			if (!t || t.length > 60) continue;
			const firstLine = t.split('\n')[0].trim();
			if (!firstLine || firstLine.length > 50) continue;
			if (MODEL_NAME_RE.test(firstLine)) found.add(firstLine);
		}
		return Array.from(found);
	}

	function getCurrentModelName() {
		const btn = findModelSelectorBtn();
		if (btn) {
			const text = (btn.textContent || '').trim();
			if (text) return text;
			// 没文本时尝试 aria-label
			const aria = btn.getAttribute('aria-label') || '';
			const m = aria.match(/[:：]\s*(.+)$/);
			if (m) return m[1].trim();
		}
		return null;
	}

	// 在所有可达的 document 中搜索 Radix Popover 模型面板
	function findModelPanel() {
		const docs = [document];
		try {
			for (const f of document.querySelectorAll('iframe')) {
				try { if (f.contentDocument) docs.push(f.contentDocument); } catch {}
			}
		} catch {}
		for (const doc of docs) {
			// Radix Popover: role="dialog" inside data-radix-popper-content-wrapper
			const popovers = doc.querySelectorAll(
				'.radix-popover-content[data-state="open"], [data-radix-popper-content-wrapper] [role="dialog"], [role="listbox"], [role="menu"]'
			);
			for (const p of popovers) {
				// 验证是模型选择面板：有搜索框 或 有 data-kb-navigate 按钮
				const hasSearch = p.querySelector('input[placeholder*="model" i], input[placeholder*="Search" i], input[placeholder*="搜索"]');
				const hasKbNav = p.querySelectorAll('button[data-kb-navigate="true"]').length > 0;
				if (hasSearch || hasKbNav) {
					console.log(LOG_PREFIX + '[ModelSwitch] 找到 Radix 面板 (search=' + !!hasSearch + ' kbNav=' + hasKbNav + ' doc=' + (doc === document ? 'main' : 'iframe') + ')');
					return p;
				}
			}
		}
		return null;
	}

	async function switchModel(targetModel) {
		if (_modelSwitchInProgress) {
			console.log(LOG_PREFIX + '[ModelSwitch] 切换进行中，跳过');
			return false;
		}
		_modelSwitchInProgress = true;
		try {
			console.log(LOG_PREFIX + '[ModelSwitch] 尝试切换到: ' + targetModel);

			// 1. 找到并点击模型选择器按钮（多层 fallback，含 iframe 搜索）
			const selectorBtn = findModelSelectorBtn();
			if (!selectorBtn) {
				console.log(LOG_PREFIX + '[ModelSwitch] 找不到模型选择器按钮（chatRoot=' + (findChatRoot() ? 'found' : 'null') + '）');
				return false;
			}
			console.log(LOG_PREFIX + '[ModelSwitch] 找到按钮: ' + (selectorBtn.textContent || '').trim().substring(0, 50));
			selectorBtn.click();
			await sleep(600);

			// 2. 轮询等待 Radix 弹出面板（搜索所有 document 包括 iframe）
			let panel = null;
			const deadline = Date.now() + 4000;
			while (!panel && Date.now() < deadline) {
				panel = findModelPanel();
				if (!panel) await sleep(200);
			}
			if (!panel) {
				console.log(LOG_PREFIX + '[ModelSwitch] 模型下拉面板未出现（已搜索 main + iframe）');
				dismissModelDropdown(selectorBtn);
				return false;
			}

			// 3. 在面板中查找搜索框并输入模型名
			const searchInput = panel.querySelector('input[type="text"], input[placeholder*="model" i], input[placeholder*="Search" i], input[placeholder*="搜索"]');
			if (searchInput) {
				searchInput.focus();
				searchInput.value = '';
				const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				nativeInputValueSetter.call(searchInput, targetModel);
				searchInput.dispatchEvent(new Event('input', { bubbles: true }));
				searchInput.dispatchEvent(new Event('change', { bubbles: true }));
				await sleep(600);
			}

			// 4. 查找匹配的模型选项并点击（Radix 使用 data-kb-navigate 按钮）
			const options = panel.querySelectorAll('button[data-kb-navigate="true"]');
			console.log(LOG_PREFIX + '[ModelSwitch] 找到 ' + options.length + ' 个选项');
			let matched = null;
			const target = targetModel.toLowerCase();

			// 4a. 精确包含匹配
			for (const opt of options) {
				const text = (opt.textContent || '').toLowerCase();
				if (text.includes(target)) { matched = opt; break; }
			}

			// 4b. 反向包含：选项首行文本
			if (!matched) {
				for (const opt of options) {
					const text = (opt.textContent || '').trim();
					const firstLine = text.split('\n')[0].trim().toLowerCase();
					if (firstLine && (firstLine.includes(target) || target.includes(firstLine))) {
						matched = opt; break;
					}
				}
			}

			// 4c. 宽泛匹配：去掉版本号和变体后缀
			if (!matched) {
				const baseTarget = target.replace(/[\d.\-]+/g, ' ').replace(/\b(low|medium|high|xhigh|fast|mini|thinking|max|minimal)\b/gi, '').replace(/\s+/g, ' ').trim();
				for (const opt of options) {
					const text = (opt.textContent || '').toLowerCase().replace(/[\d.\-]+/g, ' ').replace(/\b(low|medium|high|xhigh|fast|mini|thinking|max|minimal)\b/gi, '').replace(/\s+/g, ' ').trim();
					if (text.includes(baseTarget) || baseTarget.includes(text)) {
						matched = opt; break;
					}
				}
			}

			if (matched) {
				console.log(LOG_PREFIX + '[ModelSwitch] 匹配到: ' + (matched.textContent || '').trim().substring(0, 50));
				matched.click();
				console.log(LOG_PREFIX + '[ModelSwitch] ✅ 已切换到: ' + targetModel);
				await sleep(300);
				return true;
			} else {
				const optTexts = Array.from(options).slice(0, 5).map(o => (o.textContent || '').trim().substring(0, 40));
				console.log(LOG_PREFIX + '[ModelSwitch] 未找到模型: ' + targetModel + '（选项: ' + optTexts.join(' | ') + '）');
				dismissModelDropdown(selectorBtn);
				return false;
			}
		} catch (err) {
			console.log(LOG_PREFIX + '[ModelSwitch] 错误: ' + err);
			return false;
		} finally {
			_modelSwitchInProgress = false;
		}
	}

	// ── 获取所有可用模型 ──
	// 安全关闭下拉面板（不在 document 级别派发 Escape，避免崩溃聊天窗口）
	function dismissModelDropdown(selectorBtn) {
		try {
			// 优先：再次点击按钮以 toggle 关闭
			if (selectorBtn && selectorBtn.isConnected) { selectorBtn.click(); return; }
			// 备选：点击 body 空白处触发 blur 关闭
			document.body.click();
		} catch {}
	}

	async function getAvailableModels(panelOpened) {
		const debug = (msg) => console.log(LOG_PREFIX + '[ModelSwitch] ' + msg);

		// 纯被动扫描（不点击任何按钮，避免崩溃聊天窗口）

		// 1) 如果扩展宿主已通过官方命令打开了面板，等它渲染
		if (panelOpened) {
			const panel = await waitForElement(MODEL_PANEL_SEL, 2000);
			if (panel) {
				const models = readModelsFromPanel(panel);
				if (models.length > 0) {
					debug('从官方命令打开的面板抓到 ' + models.length + ' 个模型');
					return models;
				}
			}
		}

		// 2) 检查面板是否恰好已打开
		const existingPanel = document.querySelector(MODEL_PANEL_SEL);
		if (existingPanel) {
			const models = readModelsFromPanel(existingPanel);
			if (models.length > 0) {
				debug('从已打开的面板抓到 ' + models.length + ' 个模型');
				return models;
			}
		}

		// 3) 全页面被动扫描（不触发 click，只读已渲染的 DOM 文本）
		const found = scanPageForModelNames();
		debug('被动扫描得到 ' + found.length + ' 个模型');
		if (found.length > 0) return found;

		// 4) 最终兜底：读取当前选择器按钮文本作为已知模型
		const btn = findModelSelectorBtn();
		if (btn) {
			const current = (btn.textContent || '').trim();
			if (current && MODEL_NAME_RE.test(current)) {
				debug('仅检测到当前模型: ' + current);
				return [current];
			}
		}
		debug('未检测到可用模型（面板未打开或无可见模型元素）');
		return [];
	}

	function readModelsFromPanel(panel) {
		const options = panel.querySelectorAll(MODEL_OPTION_SEL);
		const models = [];
		for (const opt of options) {
			const text = (opt.textContent || '').trim();
			if (text && text.length > 1 && text.length < 60 && !text.includes('Search') && !text.includes('搜索')) {
				const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
				const name = lines[0] || text;
				if (name && !models.includes(name)) models.push(name);
			}
		}
		return models;
	}

	async function switchToNextModel(modelPriority) {
		const current = (getCurrentModelName() || '').toLowerCase();
		console.log(LOG_PREFIX + '[ModelSwitch] 当前模型: ' + (current || '未知'));
		for (const model of modelPriority) {
			// 跳过当前正在使用的模型
			if (current && current.includes(model.toLowerCase())) continue;
			const ok = await switchModel(model);
			if (ok) return model;
		}
		console.log(LOG_PREFIX + '[ModelSwitch] 所有备选模型均不可用');
		return null;
	}

	function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

	function waitForElement(selector, timeout, scope) {
		return new Promise(resolve => {
			// 搜索多个作用域：指定 scope、chatRoot、document
			const scopes = [scope, findChatRoot(), document].filter(Boolean);
			function tryFind() {
				for (const s of scopes) {
					const el = s.querySelector(selector);
					if (el) return el;
				}
				return null;
			}
			const el = tryFind();
			if (el) return resolve(el);
			const observer = new MutationObserver(() => {
				const el = tryFind();
				if (el) { observer.disconnect(); resolve(el); }
			});
			// 观察 document.body（涵盖主文档和 overlay），也观察 chatRoot
			observer.observe(document.body, { childList: true, subtree: true });
			const chatRoot = findChatRoot();
			if (chatRoot && chatRoot !== document.body) {
				try { observer.observe(chatRoot, { childList: true, subtree: true }); } catch {}
			}
			setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
		});
	}

	let recoveryObserver = null;
	let recoveryRetryCount = 0;
	let lastUserMessage = '';
	let lastRecoveryTs = 0;
	let lastPoolResultTs = 0;
	let _lastErrorFingerprint = '';
	let _lastSwitchFingerprint = '';  // 上次触发切号的错误指纹
	let _lastSwitchTs = 0;
	let _recoveryCooldownMs = 10000;  // 默认 10s，切号后临时拉长到 30s

	// 生成错误指纹（去除时间戳/数字，仅保留语义）
	function makeErrorFingerprint(text) {
		return (text || '')
			.toLowerCase()
			.replace(/\d+/g, '#')
			.replace(/\s+/g, ' ')
			.trim()
			.substring(0, 120);
	}

	// 防误判：检测文本是否为源码 / 终端输出 / 讨论语境（非真实错误）
	// 参考星火插件 isSourceLikeQuotaText，防止 AI 回复 / 用户讨论中的错误关键词触发恢复
	function isSourceLikeText(raw) {
		const t = (raw || '').toLowerCase();
		if (t.includes('error_patterns') || t.includes('exhaust_keywords')
			|| t.includes('rate_limit_keywords') || t.includes('rate_limit_real_markers')
			|| t.includes('function checkerrors') || t.includes('function getlateseterrortext')
			|| t.includes('const error_patterns')) return true;
		const termMarkers = ['npm run', 'npx ', 'node_modules', 'zsh', 'bash', 'fish', 'powershell'];
		for (const m of termMarkers) { if (t.includes(m)) return true; }
		if ((/(?:^|\n)\$\s/.test(t) || /(?:^|\n)%\s/.test(t)) && /quota|rate.?limit|exhausted/i.test(t)) return true;
		if (/[\u201c\u201d\u300c\u300d\u2018\u2019\u300e\u300f]/.test(raw || '') && /quota|rate.?limit|exhausted/i.test(t)) return true;
		const discussMarkers = ['能不能', '可不可以', '如何', '怎么', '实现', '脚本', '代码', '插件', '逻辑'];
		let hasDiscuss = false;
		for (const m of discussMarkers) { if (t.includes(m)) { hasDiscuss = true; break; } }
		if (hasDiscuss && /quota|rate.?limit|exhausted|额度|配额|速率限制|rate limit/i.test(t)) return true;
		return false;
	}

	// 错误元素可见性检查（参考星火插件 isVisibleQuotaElement）
	function isVisibleErrorElement(el) {
		try {
			const rect = el.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		} catch { return false; }
	}

	// 限流双重确认：检查错误文本是否包含至少一个真实标记
	function hasRateLimitRealMarker(text) {
		const lower = (text || '').toLowerCase();
		return RATE_LIMIT_REAL_MARKERS.some(m => lower.includes(m));
	}

	function findCascadeInput() {
		// 复用 bubbles 模块的 findInputEl（更准确的选择器）
		return findInputEl();
	}

	function findSendButton() {
		// 复用 bubbles 模块的 findSendBtnAdvanced（更准确的选择器）
		return findSendBtnAdvanced();
	}

	// 按钮可见性检查（参考 steipete）
	function isVisibleAndClickable(el) {
		if (!el) return false;
		const style = window.getComputedStyle(el);
		const rect = el.getBoundingClientRect();
		return !!(rect.width > 0 || rect.height > 0 || el.getClientRects().length)
			&& style.visibility !== 'hidden'
			&& style.display !== 'none'
			&& parseFloat(style.opacity) > 0
			&& !el.disabled;
	}

	function findRetryButton() {
		// 限定在聊天根内查找，避免误点侧栏/其他面板的同名重试按钮
		const scope = findChatRoot() || document;
		const btns = scope.querySelectorAll('button, [role="button"]');
		for (const btn of btns) {
			const txt = (btn.textContent || '').trim().toLowerCase();
			if ((txt === 'retry' || txt === '重试' || txt === 'try again' || txt === '再试一次') && isVisibleAndClickable(btn)) return btn;
		}
		return null;
	}

	function trackLastUserMessage() {
		// 从 DOM 中提取最后一条用户消息（限定 chat root 内）
		const userMsgs = getScanRoot().querySelectorAll(USER_MSG_SEL);
		if (userMsgs.length > 0) {
			const last = userMsgs[userMsgs.length - 1];
			const text = (last.textContent || '').trim();
			if (text) lastUserMessage = text;
		}
	}

	// 提取元素文本：拼接 data-ws-orig（汉化前原文）+ textContent（当前可见文本）
	// 这样英文 ERROR_PATTERNS 即便在汉化开启时也能匹配到原文
	function getElementErrorText(el) {
		if (!el) return '';
		const visible = (el.textContent || '').trim();
		// 收集自身和所有后代的 data-ws-orig 原文（汉化模块写入）
		const origs = [];
		const selfOrig = el.getAttribute && el.getAttribute('data-ws-orig');
		if (selfOrig) origs.push(selfOrig);
		try {
			el.querySelectorAll && el.querySelectorAll('[data-ws-orig]').forEach(n => {
				const v = n.getAttribute('data-ws-orig');
				if (v) origs.push(v);
			});
		} catch {}
		// 拼接成一段文本，让英文正则在原文上匹配
		const origText = origs.join('\n').trim();
		return origText ? (visible + '\n' + origText) : visible;
	}

	function getLatestErrorText() {
		// 扫描聊天区域最近的错误/状态消息（限定 chat root 内，避免全文档扫描）
		const scanRoot = getScanRoot();
		let latestError = '';
		let latestErrorEl = null;

		// 优先查找 .error-message 类的元素
		for (const sel of ERROR_BUBBLE_SEL) {
			const els = scanRoot.querySelectorAll(sel);
			// 从后往前找第一个"合法"的错误元素（排除 AI 消息内嵌、我们自己的 toast 等）
			for (let i = els.length - 1; i >= 0; i--) {
				const el = els[i];
				if (el.closest(ASSISTANT_MSG_SEL)) continue;
				if (el.closest(USER_MSG_SEL)) continue;
				if (el.closest('#ws-recovery-toast,[id^="ws-"]')) continue;
				if (el.closest(IGNORED_CONTEXT_SEL)) continue;
				if (el.dataset && el.dataset._wsRecoveryHandled) continue;
				if (!isVisibleErrorElement(el)) continue;
				const text = getElementErrorText(el);
				if (text && text.length > 5 && text.length < 1000) {
					if (isSourceLikeText(text)) continue;
					latestError = text;
					latestErrorEl = el;
					break;
				}
			}
			if (latestError) break;
		}

		// 文本内容匹配：从最后几条消息中反向扫描，匹配 ERROR_PATTERNS
		// 注意：排除 AI 回复 / 用户消息 / 代码编辑器（这些是"内容"，不是"错误 UI"）
		if (!latestError) {
			const msgEls = scanRoot.querySelectorAll('span, p, [class*="message"], [role="status"], [role="alert"]');
			for (let i = msgEls.length - 1; i >= 0 && i > msgEls.length - 30; i--) {
				const el = msgEls[i];
				if (el.closest(ASSISTANT_MSG_SEL)) continue;
				if (el.closest(USER_MSG_SEL)) continue;
				if (el.closest('#ws-recovery-toast,[id^="ws-"]')) continue;
				if (el.closest(IGNORED_CONTEXT_SEL)) continue;
				if (el.children.length > 5) continue;
				if (el.dataset && el.dataset._wsRecoveryHandled) continue;
				if (!isVisibleErrorElement(el)) continue;
				const t = getElementErrorText(el);
				if (t.length < 10 || t.length > 500) continue;
				if (isSourceLikeText(t)) continue;
				for (const ep of ERROR_PATTERNS) {
					if (ep.pattern.test(t)) {
						latestError = t;
						latestErrorEl = el;
						break;
					}
				}
				if (latestError) break;
			}
		}
		
		// 注意：不再扫描正常 AI 回复（之前的"备选"逻辑会把正常回复误判为错误，导致死循环）

		// 兜底 A：Cascade 把错误内嵌在 assistant message 内（如思考过程链尾部的 "⚠ 权限拒绝：Rate limit..." 或工具调用失败提示）
		// 主路径会通过 closest(ASSISTANT_MSG_SEL) 排除，导致这种内嵌错误被忽略 → 不触发恢复
		// 这里仅信任高置信关键词（专一的错误词组），避免把 AI 正常回复内容（如解释何谓 rate limit）误判
		// 命中后会走 checkForErrors → ERROR_PATTERNS 分类 → 对应 action（retry/switch-account/switch-model）
		const STRICT_RECOVERABLE_KW_RE = /权限拒绝.*rate limit|权限拒绝.*全局速率限制|提供商.*全局速率限制|rate limit exceeded|upgrade to a Pro|quota.*exhausted|monthly acu limit|usage.*limit.*reached|额度.*耗尽|配额.*(?:用完|耗尽|不足)|over their global rate limit|reached.*(?:message|rate)\s*limit|此模型已达到消息速率限制|用量配额已耗尽|insufficient credits|no credits (?:remaining|left|available)|credit(?:s)?\s*(?:exhausted|depleted)|积分.*(?:耗尽|不足|用完)|HTTP\s*5\d{2}\b|\bstatus\s*(?:code\s*)?5\d{2}\b|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|服务器内部错误|网关(?:错误|超时)|服务不可用|tool call failed|failed to (?:call|invoke|execute) tool|工具调用失败|model provider is currently not available|third-party model provider is experiencing issues|API provider is overloaded|all API providers are over capacity|all API providers are over their global rate limit/i;
		if (!latestError) {
			const asstMsgs = scanRoot.querySelectorAll(ASSISTANT_MSG_SEL);
			// 只看最后一条 assistant 消息（最近的错误），避免历史回复误判
			const lastAsst = asstMsgs.length > 0 ? asstMsgs[asstMsgs.length - 1] : null;
			if (lastAsst) {
				const candidates = lastAsst.querySelectorAll('[role="alert"], [role="status"], [class*="error" i], [class*="warning" i], [class*="banner" i], [class*="notification" i], [class*="alert" i], [class*="toast" i], span, p, div');
				for (let i = candidates.length - 1; i >= 0; i--) {
					const el = candidates[i];
					if (el.closest(IGNORED_CONTEXT_SEL)) continue;
					if (el.closest('#ws-recovery-toast,[id^="ws-"]')) continue;
					if (el.children.length > 5) continue;
					if (el.dataset && el.dataset._wsRecoveryHandled) continue;
					if (!isVisibleErrorElement(el)) continue;
					const t = getElementErrorText(el);
					if (t.length < 10 || t.length > 500) continue;
					if (!STRICT_RECOVERABLE_KW_RE.test(t)) continue;
					if (isSourceLikeText(t)) continue;
					latestError = t;
					latestErrorEl = el;
					console.log(LOG_PREFIX + '[getLatestErrorText] 命中 assistant 内嵌错误: ' + t.substring(0, 80));
					break;
				}
			}
		}

		// 最终兜底：扫描整个 document.body 查找额度关键词（banner 可能在 chat root 之外）
		// 注意：必须严格限定在"错误 UI 容器"内，否则会把 AI 聊天消息、代码、文档误判为错误
		if (!latestError) {
			const QUOTA_KW_RE = /quota.*exhausted|usage.*limit.*reached|额度.*耗尽|monthly acu limit|rate limit exceeded|upgrade to a Pro|over their global rate limit|reached.*(?:message|rate)\s*limit|速率限制|配额.*(?:用完|耗尽|不足)/i;
			// 只在明确的错误 UI 容器内查找（banner/alert/notification/error），避免命中聊天内容
			const ERROR_CONTAINER_SEL = '[role="alert"],[role="status"],[class*="banner" i],[class*="notification" i],[class*="alert" i],[class*="error" i],[class*="warning" i],[class*="toast" i]';
			const errorContainers = document.body.querySelectorAll(ERROR_CONTAINER_SEL);
			for (let i = errorContainers.length - 1; i >= 0; i--) {
				const container = errorContainers[i];
				if (container.closest(ASSISTANT_MSG_SEL)) continue;
				if (container.closest(USER_MSG_SEL)) continue;
				if (container.closest(IGNORED_CONTEXT_SEL)) continue;
				if (container.closest('#ws-recovery-toast,[id^="ws-"]')) continue;
				if (container.dataset && container.dataset._wsRecoveryHandled) continue;
				if (!isVisibleErrorElement(container)) continue;
				const t = (container.textContent || '').trim();
				if (t.length < 10 || t.length > 500) continue;
				if (!QUOTA_KW_RE.test(t)) continue;
				if (isSourceLikeText(t)) continue;
				latestError = getElementErrorText(container) || t;
				latestErrorEl = container;
				break;
			}
		}
		
		return { text: latestError, el: latestErrorEl };
	}

	function sendPoolSignal(type, lastMessage, opts) {
		opts = opts || {};
		// 测试按钮 (opts.force=true) 强制绕过总开关
		if (settings.autoSwitchEnabled === false && !opts.force) {
			console.log(LOG_PREFIX + '[trigger] sendPoolSignal 被拦截: 自动切号已关闭 (type=' + type + ')');
			return;
		}
		const signal = { type, ts: Date.now(), lastMessage: lastMessage || lastUserMessage, force: !!opts.force };
		const caller = new Error().stack ? new Error().stack.split('\n').slice(1, 4).map(function(l){return l.trim();}).join(' <- ') : 'unknown';
		console.log(LOG_PREFIX + '[trigger] sendPoolSignal: type=' + type + ', caller=' + caller);
		console.log(LOG_PREFIX + '[Recovery] 发送切号信号: ' + type);
		showRecoveryNotification('正在请求切换账号...');
		// 优先走 HTTP 桥（跨 origin 唯一可靠通道）
		// localStorage 路径是 vscode-file:// origin，sidebar webview (vscode-webview://) 收不到
		let sentViaBridge = false;
		try {
			if (typeof bridgePostResult === 'function' && typeof getBridgeUrl === 'function' && getBridgeUrl()) {
				bridgePostResult({ type: 'pool-signal', signal });
				sentViaBridge = true;
			}
		} catch (e) {
			console.warn(LOG_PREFIX + '[Recovery] bridge 发送失败，回退 localStorage:', e);
		}
		if (!sentViaBridge) {
			// 兜底：本地 localStorage（极少数情况下增强未启用桥时使用）
			console.log(LOG_PREFIX + '[trigger] sendPoolSignal 回退localStorage路径');
			localStorage.setItem('ws-pool-signal', JSON.stringify(signal));
		}
		setTimeout(() => checkPoolTimeout(signal.ts), 8000);
	}

	function checkPoolTimeout(signalTs) {
		// 检查 localStorage（非 bridge 场景）
		const raw = localStorage.getItem('ws-pool-result');
		if (raw) {
			try {
				const result = JSON.parse(raw);
				if (result.ts >= signalTs) return;
			} catch {}
		}
		// 检查 bridge 结果（已经通过 checkForPoolResult 处理过的结果 ts）
		if (lastPoolResultTs >= signalTs) return;
		console.log(LOG_PREFIX + '[Recovery] 切号超时');
		showRecoveryNotification('切号超时，扩展可能未响应');
	}

	function checkForPoolResult() {
		const raw = localStorage.getItem('ws-pool-result');
		if (!raw) return;
		try {
			const result = JSON.parse(raw);
			if (Date.now() - result.ts > 30000) return; // 只处理 30s 内的结果
			if (result.ts <= lastPoolResultTs) return; // 已处理过
			lastPoolResultTs = result.ts;

			if (result.type === 'switched') {
				console.log(LOG_PREFIX + '[trigger] 收到切号结果: switched, email=' + (result.email || '?'));
				recoveryRetryCount = 0;
				_brainlessConsecutive = 0;
				lastRecoveryTs = Date.now();
				recordRecoveryLog({ category: 'B', error: '', action: 'switch-result', result: 'switched:' + (result.email || '?') });
				localStorage.removeItem('ws-pool-result');
				localStorage.removeItem('ws-pool-signal');

				// 决定 afterAction
				const rule = getRuleForCategory('quotaErrors');
				const afterAction = (rule && rule.afterAction) || (settings.continueAfterSwitch ? 'send-continue' : 'auto');

				// 弹 banner 倒计时，倒计时结束后等 AI 对话完毕再执行
				const countdownMs = (settings.recoveryCountdownSeconds || 5) * 1000;
				_recoveryCooldownMs = countdownMs + 5000;
				showRecoveryPrompt({
					title: '切号成功 → ' + (result.email || '?'),
					category: 'quotaErrors',
					defaultAction: afterAction,
					errorText: '已切换账号，等待当前对话结束后自动继续',
					countdownMs: countdownMs,
					onExecute: (chosenAction) => {
						_recoveryCooldownMs = 15000;
						if (!settings.autoRecoveryEnabled) {
							console.log(LOG_PREFIX + '[Recovery] 切号后执行短路: autoRecoveryEnabled=false');
							return;
						}
						// 等 AI 生成结束再执行（最多等 120s）
						waitForAIIdle(() => {
							if (!settings.autoRecoveryEnabled) {
								console.log(LOG_PREFIX + '[Recovery] waitForAIIdle 回调短路: autoRecoveryEnabled=false');
								return;
							}
							console.log(LOG_PREFIX + '[Recovery] AI 已空闲，执行切号后动作: ' + chosenAction);
							executeAfterAction(chosenAction);
						});
					},
					onCancel: () => {
						_recoveryCooldownMs = 15000;
						recordRecoveryLog({ category: 'B', error: '', action: 'switch-cancel', result: 'user-cancelled' });
					},
				});
			} else if (result.type === 'switch-failed') {
				console.log(LOG_PREFIX + '[Recovery] 切号失败: ' + (result.error || ''));
				showRecoveryNotification(result.error || '切换失败，所有账号可能均无额度');
				_recoveryCooldownMs = 10000;  // 恢复正常冷却
				recordRecoveryLog({ category: 'B', error: '', action: 'switch-result', result: 'failed:' + (result.error || 'unknown') });
				localStorage.removeItem('ws-pool-result');
				localStorage.removeItem('ws-pool-signal');
			}
		} catch {}
	}

	// ── 冷却机制（防止重复触发） ──
	let _lastActionClickTs = 0;
	const ACTION_COOLDOWN_MS = 3000;

	function isInCooldown() {
		return Date.now() - _lastActionClickTs < ACTION_COOLDOWN_MS;
	}

	function markActionClick() {
		_lastActionClickTs = Date.now();
	}

	async function sendInputAndClick(text) {
		if (isInCooldown()) {
			console.log(LOG_PREFIX + '[Recovery] 冷却中，跳过');
			return false;
		}
		if (!await setInputText(text)) return false;
		markActionClick();
		setTimeout(() => trySendMessage(), 400);
		return true;
	}

	function retryLastMessage() {
		if (isInCooldown()) {
			console.log(LOG_PREFIX + '[Recovery] 冷却中，跳过 retryLastMessage');
			return;
		}
		// 优先点击 Retry 按钮
		const retryBtn = findRetryButton();
		if (retryBtn) {
			console.log(LOG_PREFIX + '[Recovery] 点击重试按钮');
			markActionClick();
			retryBtn.click();
			return;
		}
		if (lastUserMessage) {
			console.log(LOG_PREFIX + '[Recovery] 重发最后一条消息');
			sendInputAndClick(lastUserMessage);
		}
	}

	function showRecoveryNotification(message, type) {
		if (!message) return;
		// 自动判类型（未显式指定时）
		if (!type) {
			const m = String(message);
			if (/超时|失败|错误|无可用|无备选|耗尽|未响应|gave-up/i.test(m)) type = 'error';
			else if (/成功|已切换|已启用|完成|已就绪/i.test(m)) type = 'success';
			else type = 'info';
		}
		const palette = {
			info:    { accent: '#3b82f6', icon: '🔄', iconBg: 'rgba(59,130,246,0.12)' },
			success: { accent: '#10b981', icon: '✅', iconBg: 'rgba(16,185,129,0.12)' },
			error:   { accent: '#f59e0b', icon: '⚠️', iconBg: 'rgba(245,158,11,0.12)' },
		};
		const c = palette[type] || palette.info;

		let toast = document.getElementById('ws-recovery-toast');
		if (!toast) {
			toast = document.createElement('div');
			toast.id = 'ws-recovery-toast';
			document.body.appendChild(toast);
		}
		// 重置样式
		toast.style.cssText = [
			'position:fixed', 'top:80px', 'right:20px',
			'max-width:380px', 'min-width:200px',
			'background:rgba(30,30,36,0.92)',
			'backdrop-filter:blur(16px) saturate(1.4)',
			'-webkit-backdrop-filter:blur(16px) saturate(1.4)',
			'color:#e6edf3',
			'padding:0',
			'border-radius:12px',
			'font-size:12.5px', 'font-weight:500', 'line-height:1.4',
			'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif',
			'z-index:2147483647',
			'border:1px solid rgba(255,255,255,0.06)',
			'box-shadow:0 8px 32px rgba(0,0,0,0.5),0 2px 8px rgba(0,0,0,0.25),inset 0 1px 0 rgba(255,255,255,0.04)',
			'transition:opacity 0.3s cubic-bezier(0.4,0,0.2,1),transform 0.3s cubic-bezier(0.4,0,0.2,1)',
			'display:flex', 'align-items:stretch',
			'pointer-events:auto', 'overflow:hidden',
			'opacity:0', 'transform:translateX(16px) scale(0.96)',
		].join(';');
		setSafeHTML(toast,
			'<div style="width:3px;background:' + c.accent + ';flex-shrink:0;border-radius:12px 0 0 12px"></div>'
			+ '<div style="display:flex;align-items:center;gap:10px;padding:12px 36px 12px 12px;flex:1;min-width:0">'
			+   '<div style="width:26px;height:26px;border-radius:7px;background:' + c.iconBg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:13px">' + c.icon + '</span></div>'
			+   '<span style="word-break:break-word;color:#e2e8f0;font-size:12px">' + escapeHtml(message) + '</span>'
			+ '</div>'
			+ '<span id="ws-toast-close" style="position:absolute;top:8px;right:10px;cursor:pointer;color:rgba(148,163,184,0.5);font-size:12px;line-height:1;padding:3px 5px;user-select:none;border-radius:4px;transition:all 0.15s">✕</span>');

		// 滑入动画
		requestAnimationFrame(() => {
			toast.style.opacity = '1';
			toast.style.transform = 'translateX(0) scale(1)';
		});

		// 隐藏函数（动画结束后彻底隐藏）
		function hideToast() {
			if (!toast) return;
			toast.style.opacity = '0';
			toast.style.transform = 'translateX(16px) scale(0.96)';
			setTimeout(() => { if (toast) toast.style.display = 'none'; }, 350);
		}

		// 关闭按钮
		const closeBtn = toast.querySelector('#ws-toast-close');
		if (closeBtn) closeBtn.onclick = hideToast;

		// 自动隐藏（4s）
		clearTimeout(toast._hideTimer);
		toast._hideTimer = setTimeout(hideToast, 4000);
	}

	// ========== 恢复日志 ==========
	const RECOVERY_LOG_KEY = 'ws-recovery-log';
	const RECOVERY_LOG_MAX = 100;
	let _logSyncSeq = 0;
	function recordRecoveryLog(entry) {
		try {
			const raw = localStorage.getItem(RECOVERY_LOG_KEY);
			const list = raw ? JSON.parse(raw) : [];
			list.push(Object.assign({ ts: Date.now() }, entry));
			while (list.length > RECOVERY_LOG_MAX) list.shift();
			localStorage.setItem(RECOVERY_LOG_KEY, JSON.stringify(list));
			// 新增日志后主动推送到 bridge
			_logSyncSeq++;
			_debouncedPushLogs();
		} catch {}
	}
	let _pushLogsTimer = null;
	let _logSyncIntervalTimer = null;
	function _debouncedPushLogs() {
		if (_pushLogsTimer) return;
		_pushLogsTimer = setTimeout(() => {
			_pushLogsTimer = null;
			_pushLogsTobridge();
		}, 2000);
	}
	function _pushLogsTobridge() {
		try {
			if (typeof bridgePostResult !== 'function' || typeof getBridgeUrl !== 'function' || !getBridgeUrl()) return;
			let recoveryLogs = [], diagnoseLogs = [];
			try { const r = localStorage.getItem(RECOVERY_LOG_KEY); if (r) recoveryLogs = JSON.parse(r) || []; } catch {}
			try { const d = localStorage.getItem('ws-diagnose-log'); if (d) diagnoseLogs = JSON.parse(d) || []; } catch {}
			bridgePostResult({ action: 'syncLogs', status: 'done', payload: { recoveryLogs, diagnoseLogs } });
		} catch {}
	}

	// ========== 扫描诊断日志 ==========
	// 用于排查"为什么 banner 没触发"：每次 checkForErrors 扫描时记录一条诊断快照
	const DIAGNOSE_LOG_KEY = 'ws-diagnose-log';
	const DIAGNOSE_LOG_MAX = 50;
	function recordDiagnose(entry) {
		try {
			const raw = localStorage.getItem(DIAGNOSE_LOG_KEY);
			const list = raw ? JSON.parse(raw) : [];
			list.push(Object.assign({ ts: Date.now() }, entry));
			while (list.length > DIAGNOSE_LOG_MAX) list.shift();
			localStorage.setItem(DIAGNOSE_LOG_KEY, JSON.stringify(list));
		} catch {}
	}
	// 扫描全局 DOM，找疑似错误元素，返回候选数组（不修改任何状态）
	function collectErrorCandidates() {
		const candidates = [];
		const RE = /权限拒绝|速率限制|rate limit|quota|额度|配额|all API providers|内部错误|provider unreachable/i;
		try {
			const allEls = document.body.querySelectorAll('span, p, div, [role="alert"], [role="status"]');
			for (const el of allEls) {
				const txt = (el.textContent || '').trim();
				if (txt.length < 10 || txt.length > 500) continue;
				if (el.children.length > 5) continue;
				if (!RE.test(txt)) continue;
				if (el.closest('#ws-recovery-toast,[id^="ws-"]')) continue;
				const selfOrig = el.getAttribute && el.getAttribute('data-ws-orig');
				const descOrigList = [];
				try {
					el.querySelectorAll('[data-ws-orig]').forEach(n => descOrigList.push(n.getAttribute('data-ws-orig')));
				} catch {}
				let ancestorOrig = null;
				let p = el.parentElement;
				for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
					if (p.hasAttribute && p.hasAttribute('data-ws-orig')) {
						ancestorOrig = { level: i + 1, text: p.getAttribute('data-ws-orig').substring(0, 100) };
						break;
					}
				}
				candidates.push({
					text: txt.substring(0, 200),
					inAssistant: !!el.closest(ASSISTANT_MSG_SEL),
					inUser: !!el.closest(USER_MSG_SEL),
					handled: !!(el.dataset && el.dataset._wsRecoveryHandled),
					selfOrig: selfOrig ? selfOrig.substring(0, 100) : null,
					descOrigCount: descOrigList.length,
					descOrigSample: descOrigList[0] ? descOrigList[0].substring(0, 100) : null,
					ancestorOrig: ancestorOrig,
					tag: el.tagName,
					childCount: el.children.length
				});
				if (candidates.length >= 5) break;
			}
		} catch {}
		return candidates;
	}

	// ========== v6.6.0 偏好持久化（全局作用域） ==========
	// 用户在 banner 上勾选"下次同类错误默认用此策略"时，把分类→action 写到 localStorage
	const RECOVERY_PREFS_KEY = 'ws-recovery-prefs';
	function loadRecoveryPrefs() {
		try {
			const raw = localStorage.getItem(RECOVERY_PREFS_KEY);
			return raw ? JSON.parse(raw) : {};
		} catch { return {}; }
	}
	function saveRecoveryPref(category, action) {
		try {
			const prefs = loadRecoveryPrefs();
			prefs[category] = action;
			localStorage.setItem(RECOVERY_PREFS_KEY, JSON.stringify(prefs));
			console.log(LOG_PREFIX + '[Recovery] 已记住偏好: ' + category + ' → ' + action);
		} catch {}
	}
	function getPreferredAction(category) {
		const prefs = loadRecoveryPrefs();
		return prefs[category] || null;
	}
	function clearAllRecoveryPrefs() {
		try { localStorage.removeItem(RECOVERY_PREFS_KEY); } catch {}
	}
	// 暴露给侧栏 / 调试用
	if (typeof window !== 'undefined') {
		window.__wsClearRecoveryPrefs = clearAllRecoveryPrefs;
	}

	// ========== v6.6.0 交互式恢复确认 Banner ==========
	// 单例：同一时间只显示一个 banner，新错误覆盖旧的
	// 形态：聊天输入框正上方横条，灰色实色背景，倒计时进度条 + 候选策略按钮
	// 交互：点未选中按钮 = 切换+重置倒计时；点已选中 = 立即执行；
	//       checkbox = 勾选后该选择写入偏好；取消 = 终止本轮
	const RECOVERY_BANNER_ID = 'ws-recovery-banner';
	let _bannerState = null;  // { timer, deadline, defaultAction, options }

	// 候选操作按分类映射（标签 + 排序，默认 action 由调用方传入）
	const CATEGORY_CANDIDATES = {
		networkErrors:      [['retry','重试'], ['send-continue','发继续'], ['switch-model','切换模型'], ['switch-account','切换账号']],
		modelErrors:        [['send-continue','发继续'], ['switch-model','切换模型'], ['switch-account','切换账号'], ['retry','重试']],
		quotaErrors:        [['switch-account','切换账号'], ['send-continue','发继续'], ['retry','重试']],
		continuationErrors: [['send-continue','发继续']],
		permissionRequests: [['auto-allow','自动允许']],
		userIntervention:   [],  // 不自动恢复
		custom:             [['retry','重试'], ['send-continue','发继续'], ['switch-account','切换账号'], ['switch-model','切换模型']],
	};

	const ACTION_LABEL = {
		'retry': '重试',
		'send-continue': '发继续',
		'switch-model': '切换模型',
		'switch-account': '切换账号',
		'auto-allow': '自动允许',
		'notify': '提示',
	};

	function dismissRecoveryBanner() {
		if (_bannerState && _bannerState.timer) {
			clearInterval(_bannerState.timer);
		}
		_bannerState = null;
		const el = document.getElementById(RECOVERY_BANNER_ID);
		if (el) { try { el.remove(); } catch {} }
	}

	// 显示恢复确认 banner，倒计时结束后执行 onExecute(chosenAction)
	// options: { category, defaultAction, errorText, countdownMs, onExecute, onCancel, hint }
	function showRecoveryPrompt(options) {
		const opts = options || {};
		const category = opts.category || 'custom';
		let chosen = opts.defaultAction || 'retry';
		// 第五轮架构修复 #2：禁用过滤器，用于把被子开关禁用的 action 标记为不可点
		const isActionDisabled = typeof opts.isActionDisabled === 'function' ? opts.isActionDisabled : () => false;
		const candidates = (CATEGORY_CANDIDATES[category] || CATEGORY_CANDIDATES.custom).slice();
		// 确保 defaultAction 在候选列表里（不在则插到首位）
		if (!candidates.some(c => c[0] === chosen)) candidates.unshift([chosen, ACTION_LABEL[chosen] || chosen]);

		const countdownMs = Math.max(2000, opts.countdownMs || (settings.recoveryCountdownSeconds || 5) * 1000);
		let deadline = Date.now() + countdownMs;

		// 单例：先清掉旧 banner
		dismissRecoveryBanner();

		const banner = document.createElement('div');
		banner.id = RECOVERY_BANNER_ID;
		banner.style.cssText = [
			'position:fixed', 'right:20px', 'bottom:120px',
			'min-width:380px', 'max-width:480px',
			'background:rgba(30,30,36,0.92)',
			'backdrop-filter:blur(16px) saturate(1.4)',
			'-webkit-backdrop-filter:blur(16px) saturate(1.4)',
			'color:#e6edf3',
			'padding:0',
			'border-radius:14px',
			'border:1px solid rgba(255,255,255,0.06)',
			'box-shadow:0 8px 32px rgba(0,0,0,0.55),0 2px 8px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.04)',
			'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Inter",sans-serif',
			'font-size:12.5px', 'line-height:1.5',
			'z-index:2147483647',
			'pointer-events:auto',
			'opacity:0', 'transform:translateY(12px) scale(0.98)',
			'transition:opacity 0.3s cubic-bezier(0.4,0,0.2,1),transform 0.3s cubic-bezier(0.4,0,0.2,1)',
			'overflow:hidden',
		].join(';');

		// 头部：标题 + 错误摘要
		const errSummary = (opts.errorText || opts.hint || '').toString().substring(0, 90);
		const headTitle = opts.title || '检测到错误';

		// 候选按钮 HTML（第五轮修复 #2：禁用的 action 置灰且不可点）
		const btnsHtml = candidates.map(c => {
			const [act, label] = c;
			const isDefault = act === chosen;
			const disabled = isActionDisabled(act);
			let bg, color, border, cursor = 'pointer', extraLabel = '', shadow = 'none';
			if (disabled) {
				bg = 'rgba(40,40,48,0.6)'; color = '#5b6070'; border = '1px dashed rgba(100,100,120,0.3)'; cursor = 'not-allowed';
				extraLabel = ' (已禁用)';
			} else if (isDefault) {
				bg = 'linear-gradient(135deg,#3b82f6,#2563eb)'; color = '#fff'; border = '1px solid rgba(59,130,246,0.5)';
				extraLabel = ' ✓'; shadow = '0 2px 8px rgba(59,130,246,0.35)';
			} else {
				bg = 'rgba(55,55,68,0.7)'; color = '#c8d1dc'; border = '1px solid rgba(100,100,120,0.25)';
			}
			return '<button data-action="' + act + '" data-disabled="' + (disabled ? '1' : '0') + '" class="ws-rb-act' + (isDefault ? ' is-default' : '') + (disabled ? ' is-disabled' : '') + '" '
				+ 'style="background:' + bg + ';color:' + color + ';border:' + border + ';'
				+ 'padding:6px 14px;border-radius:8px;font-size:11.5px;cursor:' + cursor + ';'
				+ 'font-family:inherit;font-weight:500;transition:all 0.2s cubic-bezier(0.4,0,0.2,1);margin-right:6px;margin-bottom:4px;'
				+ 'box-shadow:' + shadow + ';letter-spacing:0.01em;"'
				+ (disabled ? ' title="此动作已被子开关禁用，请在侧栏开启"' : '') + '>'
				+ label + extraLabel + '</button>';
		}).join('');

		setSafeHTML(banner,
			// 顶部渐变装饰线
			'<div style="height:3px;background:linear-gradient(90deg,#3b82f6,#8b5cf6,#06b6d4);border-radius:14px 14px 0 0"></div>'
			// 内容区
			+ '<div style="padding:16px 18px 14px">'
			// 头部
			+ '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">'
			+   '<div style="width:28px;height:28px;border-radius:8px;background:rgba(245,158,11,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:15px">⚡</span></div>'
			+   '<div style="flex:1;min-width:0">'
			+     '<div style="font-weight:600;font-size:13px;color:#f1f5f9;line-height:1.3">' + escapeHtml(headTitle) + '</div>'
			+     (errSummary ? '<div style="color:#8b95a5;font-size:11px;margin-top:2px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(errSummary) + '</div>' : '')
			+   '</div>'
			+   '<div class="ws-rb-countdown" style="background:rgba(59,130,246,0.12);color:#60a5fa;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;flex-shrink:0">' + Math.ceil(countdownMs / 1000) + 's</div>'
			+ '</div>'
			// 状态提示
			+ '<div style="color:#9ca3af;font-size:11.5px;margin-bottom:12px;padding-left:38px">'
			+   '<span class="ws-rb-status">' + Math.ceil(countdownMs / 1000) + 's 后自动「<b style="color:#e2e8f0">' + escapeHtml(ACTION_LABEL[chosen] || chosen) + '</b>」 · 点其他按钮可切换策略，再点一下立即执行</span>'
			+ '</div>'
			// 操作按钮
			+ '<div style="margin-bottom:12px;padding-left:38px;display:flex;flex-wrap:wrap;gap:6px">' + btnsHtml + '</div>'
			// 进度条
			+ '<div style="height:4px;background:rgba(255,255,255,0.04);border-radius:4px;overflow:hidden;margin-bottom:14px;margin-left:38px">'
			+   '<div class="ws-rb-bar" style="height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);width:100%;transition:width 0.1s linear;border-radius:4px;box-shadow:0 0 8px rgba(59,130,246,0.4)"></div>'
			+ '</div>'
			// 底部操作栏
			+ '<div style="display:flex;align-items:center;gap:10px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05)">'
			+   '<label style="display:flex;align-items:center;gap:7px;color:#6b7280;font-size:11px;cursor:pointer;user-select:none">'
			+     '<input type="checkbox" class="ws-rb-remember" style="cursor:pointer;accent-color:#3b82f6">'
			+     '<span>记住此选择</span>'
			+   '</label>'
			+   '<div style="margin-left:auto;display:flex;gap:8px">'
			+     '<button class="ws-rb-cancel" style="background:transparent;color:#6b7280;border:1px solid rgba(100,100,120,0.25);padding:6px 13px;border-radius:8px;font-size:11.5px;cursor:pointer;font-family:inherit;font-weight:500;transition:all 0.2s">✕ 取消</button>'
			+     '<button class="ws-rb-now" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:6px 16px;border-radius:8px;font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(16,185,129,0.3);transition:all 0.2s">▶ 立即执行</button>'
			+   '</div>'
			+ '</div>'
			+ '</div>' // 结束内容区
		);

		document.body.appendChild(banner);
		requestAnimationFrame(() => {
			banner.style.opacity = '1';
			banner.style.transform = 'translateY(0) scale(1)';
		});

		// === 状态更新 ===
		function refreshUI() {
			const now = Date.now();
			const remain = Math.max(0, deadline - now);
			const total = countdownMs;
			const pct = Math.max(0, Math.min(100, (remain / total) * 100));
			const bar = banner.querySelector('.ws-rb-bar');
			if (bar) bar.style.width = pct + '%';
			const cd = banner.querySelector('.ws-rb-countdown');
			if (cd) cd.textContent = Math.ceil(remain / 1000) + 's';
			const status = banner.querySelector('.ws-rb-status');
			if (status) setSafeHTML(status, Math.ceil(remain / 1000) + 's 后自动「<b style="color:#e2e8f0">' + escapeHtml(ACTION_LABEL[chosen] || chosen) + '</b>」 · 点其他按钮可切换策略，再点一下立即执行');
		}

		function highlightDefault() {
			banner.querySelectorAll('button.ws-rb-act').forEach(btn => {
				const act = btn.getAttribute('data-action');
				// 第五轮修复 #2：禁用按钮保持禁用样式，不参与默认选中切换
				if (btn.getAttribute('data-disabled') === '1') {
					btn.style.background = 'rgba(40,40,48,0.6)';
					btn.style.color = '#5b6070';
					btn.style.border = '1px dashed rgba(100,100,120,0.3)';
					btn.style.boxShadow = 'none';
					btn.textContent = (ACTION_LABEL[act] || act) + ' (已禁用)';
					return;
				}
				if (act === chosen) {
					btn.classList.add('is-default');
					btn.style.background = 'linear-gradient(135deg,#3b82f6,#2563eb)';
					btn.style.color = '#fff';
					btn.style.border = '1px solid rgba(59,130,246,0.5)';
					btn.style.boxShadow = '0 2px 8px rgba(59,130,246,0.35)';
					btn.textContent = (ACTION_LABEL[act] || act) + ' ✓';
				} else {
					btn.classList.remove('is-default');
					btn.style.background = 'rgba(55,55,68,0.7)';
					btn.style.color = '#c8d1dc';
					btn.style.border = '1px solid rgba(100,100,120,0.25)';
					btn.style.boxShadow = 'none';
					btn.textContent = (ACTION_LABEL[act] || act);
				}
			});
		}

		function execute() {
			if (_bannerState && _bannerState.timer) clearInterval(_bannerState.timer);
			const remember = !!banner.querySelector('.ws-rb-remember')?.checked;
			if (remember) saveRecoveryPref(category, chosen);
			// 关闭 banner
			banner.style.opacity = '0';
			banner.style.transform = 'translateY(8px) scale(0.96)';
			setTimeout(() => { try { banner.remove(); } catch {} }, 250);
			_bannerState = null;
			console.log(LOG_PREFIX + '[Recovery] Banner 执行: ' + chosen + (remember ? ' (已记忆)' : ''));
			try { opts.onExecute && opts.onExecute(chosen, remember); } catch (e) { console.warn(LOG_PREFIX, '[Recovery] onExecute 异常', e); }
		}

		function cancel() {
			if (_bannerState && _bannerState.timer) clearInterval(_bannerState.timer);
			banner.style.opacity = '0';
			banner.style.transform = 'translateY(8px) scale(0.96)';
			setTimeout(() => { try { banner.remove(); } catch {} }, 250);
			_bannerState = null;
			console.log(LOG_PREFIX + '[Recovery] Banner 取消');
			try { opts.onCancel && opts.onCancel(); } catch {}
		}

		// === 事件绑定 ===
		banner.querySelectorAll('button.ws-rb-act').forEach(btn => {
			btn.addEventListener('click', () => {
				const act = btn.getAttribute('data-action');
				// 第五轮修复 #2：禁用按钮点击无效（保留按钮以便用户看到"为什么没出现这个选项"）
				if (btn.getAttribute('data-disabled') === '1') {
					showRecoveryNotification('此动作已被子开关禁用，请在侧栏开启对应开关', 'error');
					return;
				}
				if (act === chosen) {
					// 点已选中 = 立即执行
					execute();
				} else {
					// 点未选中 = 切换默认 + 重置倒计时
					chosen = act;
					deadline = Date.now() + countdownMs;
					highlightDefault();
					refreshUI();
				}
			});
		});
		banner.querySelector('.ws-rb-now').addEventListener('click', execute);
		banner.querySelector('.ws-rb-cancel').addEventListener('click', cancel);

		// === 倒计时定时器 ===
		const timer = setInterval(() => {
			if (Date.now() >= deadline) {
				clearInterval(timer);
				execute();
				return;
			}
			refreshUI();
		}, 100);
		_bannerState = { timer, deadline, defaultAction: chosen, options: opts };
	}

	// HTML 转义
	function escapeHtml(s) {
		return String(s || '').replace(/[<>&"']/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[ch]));
	}

	// ── 获取当前分类的恢复规则 ──
	function getRuleForCategory(category) {
		const rules = settings.recoveryRules || {};
		return rules[category] || null;
	}

	// ── 匹配自定义规则（优先于内置） ──
	function matchCustomRule(errorText) {
		const customs = settings.customRecoveryRules || [];
		for (const rule of customs) {
			if (!rule.enabled || !rule.pattern) continue;
			try {
				const re = new RegExp(rule.pattern, 'i');
				if (re.test(errorText)) return rule;
			} catch {}
		}
		return null;
	}

	// ── 执行 afterAction（切换后动作） ──
	function executeAfterAction(afterAction, opts) {
		opts = opts || {};
		const action = afterAction || 'auto';
		if (action === 'none') return;
		if (action === 'send-continue') {
			console.log(LOG_PREFIX + '[Recovery] 执行后续动作: 发送继续');
			sendContinueMessage();
			return;
		}
		if (action === 'retry-message') {
			console.log(LOG_PREFIX + '[Recovery] 执行后续动作: 重发消息');
			if (lastUserMessage) sendInputAndClick(lastUserMessage);
			return;
		}
		// auto: 智能判断 — 有 Retry 按钮就点，否则发继续
		const retryBtn = findRetryButton();
		if (retryBtn) {
			console.log(LOG_PREFIX + '[Recovery] auto: 点击重试按钮');
			markActionClick();
			retryBtn.click();
		} else {
			console.log(LOG_PREFIX + '[Recovery] auto: 发送继续');
			sendContinueMessage();
		}
	}

	// ── 统一错误处理入口 ──
	function checkForErrors() {
		if (!settings.autoRecoveryEnabled) return;
		const { text: errorText, el: errorEl } = getLatestErrorText();
		if (!errorText) {
			// 没找到错误：如果 DOM 里其实有疑似错误候选，记录一条诊断
			const cands = collectErrorCandidates();
			if (cands.length > 0) {
				recordDiagnose({
					stage: 'no-match',
					reason: 'getLatestErrorText 未命中，但全局扫描发现疑似错误',
					hitText: '',
					hitInAssistant: null,
					candidatesCount: cands.length,
					candidates: cands
				});
			}
			return;
		}

		// 标记已处理的错误元素，防止同一 DOM 元素反复触发
		if (errorEl) {
			if (errorEl.dataset && errorEl.dataset._wsRecoveryHandled) return;
		}

		// 防抖：同一错误冷却期内不重复处理
		const now = Date.now();
		if (now - lastRecoveryTs < _recoveryCooldownMs) {
			console.log(LOG_PREFIX + '[trigger] checkForErrors 跳过: 冷却中 (' + Math.round((_recoveryCooldownMs - (now - lastRecoveryTs)) / 1000) + 's剩余), error=' + errorText.substring(0, 80));
			recordDiagnose({
				stage: 'cooldown-skip',
				reason: '冷却中 (' + Math.round((_recoveryCooldownMs - (now - lastRecoveryTs)) / 1000) + 's 剩余)',
				hitText: errorText.substring(0, 200),
				hitInAssistant: errorEl ? !!errorEl.closest(ASSISTANT_MSG_SEL) : null
			});
			return;
		}
		if (_bannerState) {
			console.log(LOG_PREFIX + '[trigger] checkForErrors 跳过: banner 显示中，暂不标记错误元素, error=' + errorText.substring(0, 80));
			recordDiagnose({
				stage: 'banner-shown-skip',
				reason: 'banner 已在显示中',
				hitText: errorText.substring(0, 200),
				hitInAssistant: errorEl ? !!errorEl.closest(ASSISTANT_MSG_SEL) : null
			});
			return;
		}

		// 指纹去重：如果当前错误和上次触发切号的错误一样，跳过（避免 DOM 残留反复触发）
		const fp = makeErrorFingerprint(errorText);
		if (fp && fp === _lastSwitchFingerprint && now - _lastSwitchTs < 60000) {
			if (errorEl) {
				try { errorEl.dataset._wsRecoveryHandled = '1'; } catch {}
			}
			console.log(LOG_PREFIX + '[trigger] checkForErrors 跳过: 指纹相同且未超过60s (switchAge=' + Math.round((now - _lastSwitchTs) / 1000) + 's)');
			return;
		}
		console.log(LOG_PREFIX + '[trigger] checkForErrors 检测到错误: ' + errorText.substring(0, 120) + ' | fp=' + fp + ' | lastSwitchFp=' + _lastSwitchFingerprint + ' | cooldown=' + _recoveryCooldownMs + 'ms | sinceLastRecovery=' + (now - lastRecoveryTs) + 'ms');

		// 优先匹配自定义规则
		const customRule = matchCustomRule(errorText);
		if (customRule) {
			if (errorEl) {
				try { errorEl.dataset._wsRecoveryHandled = '1'; } catch {}
			}
			lastRecoveryTs = now;
			console.log(LOG_PREFIX + '[Recovery] 命中自定义规则: ' + customRule.name);
			recordRecoveryLog({ category: 'custom', error: errorText.substring(0, 200), action: customRule.action, result: 'matched:' + customRule.name });
			executeRuleAction(customRule, errorText, now);
			return;
		}

		// 匹配内置错误模式表
		for (const ep of ERROR_PATTERNS) {
			if (!ep.pattern.test(errorText)) continue;

			// 限流双重确认：rate-limited 信号需额外验证真实标记（防 AI 讨论误判）
			if (ep.signal === 'rate-limited' && !hasRateLimitRealMarker(errorText)) {
				console.log(LOG_PREFIX + '[Recovery] rate-limited 双重确认失败（缺少 trace id 等真实标记），跳过: ' + errorText.substring(0, 80));
				continue;
			}

			const category = ep.category;
			const rule = getRuleForCategory(category);
			if (!rule) {
				recordDiagnose({
					stage: 'no-rule',
					reason: 'ERROR_PATTERN 命中 [' + category + ']，但 recoveryRules 中无该分类的规则',
					hitText: errorText.substring(0, 200),
					hitInAssistant: errorEl ? !!errorEl.closest(ASSISTANT_MSG_SEL) : null,
					category: category
				});
				continue;
			}

			// 用户记忆的偏好优先于 rule.action（v6.6.0）
			const preferred = getPreferredAction(category);
			const action = preferred || rule.action || 'notify';
			console.log(LOG_PREFIX + '[Recovery] 命中 [' + category + '] 动作=' + action + (preferred ? ' (用户偏好)' : ''));
			recordDiagnose({
				stage: 'pattern-matched',
				reason: '命中 ERROR_PATTERN [' + category + ']，将走 banner',
				hitText: errorText.substring(0, 200),
				hitInAssistant: errorEl ? !!errorEl.closest(ASSISTANT_MSG_SEL) : null,
				category: category,
				action: action,
				pattern: ep.pattern.source.substring(0, 80)
			});

			// 走 banner 倒计时（v6.6.0：所有恢复操作都走 banner，让用户知道软件介入了）
			if (errorEl) {
				try { errorEl.dataset._wsRecoveryHandled = '1'; } catch {}
			}
			maybeShowConfirmAndDispatch(action, rule, ep, errorText, now, category);
			return;
		}

		// 走到这里：errorText 拿到了，但所有 ERROR_PATTERNS 都没命中
		recordDiagnose({
			stage: 'pattern-miss',
			reason: '已获取错误文本，但无任何 ERROR_PATTERN 匹配',
			hitText: errorText.substring(0, 300),
			hitInAssistant: errorEl ? !!errorEl.closest(ASSISTANT_MSG_SEL) : null,
			selfOrig: (errorEl && errorEl.getAttribute) ? errorEl.getAttribute('data-ws-orig') : null
		});
	}

	// ── 通用规则执行 ──
	function executeRuleAction(rule, errorText, now) {
		const action = rule.action || 'notify';
		// 自定义规则也走 banner 倒计时
		maybeShowConfirmAndDispatch(action, rule, rule, errorText, now, 'custom');
	}

	// v6.6.0：执行某个 action 的实际工作（保留原有所有保护逻辑）
	function dispatchRecoveryAction(action, rule, ep, errorText, now, category) {
		if (action === 'retry') {
			if (settings.guardian && settings.guardian.autoRetry === false) return;
			handleRetryAction(rule, errorText, now, category);
		} else if (action === 'switch-account') {
			if (settings.autoSwitchEnabled === false) {
				console.log(LOG_PREFIX + '[Recovery] 自动切号已关闭，switch-account 降级为 notify (category=' + category + ')');
				showRecoveryNotification((ep && ep.hint) || errorText.substring(0, 80));
				recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'notify', result: 'autoSwitch-off-fallback' });
				return;
			}
			handleSwitchAccountAction(rule, ep, errorText, now, category);
		} else if (action === 'switch-model') {
			handleSwitchModelAction(rule, ep, errorText, now, category);
		} else if (action === 'send-continue') {
			handleSendContinueAction(errorText, now, category);
		} else if (action === 'auto-allow') {
			// 权限自动允许：直接调用现有的权限处理逻辑（如果存在）
			// 如果不存在，仅记录日志
			if (typeof autoAllowPermission === 'function') {
				autoAllowPermission(rule);
			}
			recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'auto-allow', result: 'executed' });
		} else if (action === 'notify') {
			const hint = (ep && ep.hint) || errorText.substring(0, 80);
			showRecoveryNotification(hint);
			recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'notify', result: hint });
		}
		// 'ignore' / 未知 → 什么都不做
	}

	// v6.6.0+v6.6.2 第五轮架构审查修订：弹 banner 倒计时确认 → 倒计时结束后执行 dispatchRecoveryAction
	//
	// 第五轮保留的修复：
	// - 修复 #2（子开关一致性）：检查子开关后再决定是否弹 banner / 哪些按钮可用。
	//   被子开关禁用的 action 在 banner 上置灰，避免用户点了按钮没反应（静默失败）。
	//
	// 「记住此选择」的设计语义（Soft 模式，不修改）：
	// - 勾选 = 下次同类错误时 banner 仍然弹出，但默认选中的策略变成用户偏好的
	// - banner 的存在意义是「通知用户软件介入了 + 给 5s 反悔窗口」
	// - 如果跳过 banner 直接执行，会剥夺用户的反悔权 → 违背设计初心
	//
	// userIntervention（需用户介入）不倒计时，仅 toast 提示
	function maybeShowConfirmAndDispatch(action, rule, ep, errorText, now, category) {
		// userIntervention：不能自动恢复
		if (category === 'userIntervention') {
			const hint = (ep && ep.hint) || errorText.substring(0, 80);
			showRecoveryNotification(hint, 'error');
			recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'notify', result: 'user-intervention:' + hint });
			return;
		}

		// 子开关检查（必须在 recoveryConfirmEnabled 之前，确保关闭 banner 时仍有 fallback）
		const isActionDisabled = (act) => {
			if (act === 'retry' && settings.guardian && settings.guardian.autoRetry === false) return true;
			if (act === 'switch-account' && settings.autoSwitchEnabled === false) return true;
			if ((act === 'send-continue' || act === 'continue') && settings.continueMode === 'off') return true;
			return false;
		};
		if (isActionDisabled(action)) {
			console.log(LOG_PREFIX + '[Recovery] 默认动作 [' + action + '] 被子开关禁用，尝试 fallback');
			const fallback = (CATEGORY_CANDIDATES[category] || []).find(c => !isActionDisabled(c[0]));
			if (fallback) {
				action = fallback[0];
			} else {
				// 所有候选都被禁用 → 只 toast 提示
				showRecoveryNotification('自动恢复已禁用（请检查侧栏设置）', 'error');
				recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'all-disabled', result: 'skipped' });
				return;
			}
		}

		// 总开关关闭 → 走老逻辑直接执行（无 banner）
		if (settings.recoveryConfirmEnabled === false) {
			dispatchRecoveryAction(action, rule, ep, errorText, now, category);
			return;
		}

		// 第四轮修复：banner 已在显示时不重弹（保护用户当前选择不被新错误覆盖）
		if (_bannerState) {
			console.log(LOG_PREFIX + '[Recovery] banner 已在显示中，忽略新错误避免覆盖用户选择: ' + errorText.substring(0, 60));
			return;
		}

		// 第四轮修复：弹出 banner 时立即占用冷却（防 banner 倒计时期间被其他错误重弹）
		const countdownMs = (settings.recoveryCountdownSeconds || 5) * 1000;
		lastRecoveryTs = now;
		_recoveryCooldownMs = countdownMs + 5000;

		// 弹 banner，倒计时后执行
		const titleMap = {
			networkErrors: '网络/超时错误',
			modelErrors: '模型提供商不可达',
			quotaErrors: '配额耗尽 / 限流',
			continuationErrors: '工具调用上限',
			permissionRequests: '权限请求',
			custom: '自定义规则触发',
		};
		showRecoveryPrompt({
			title: titleMap[category] || '检测到错误',
			category,
			defaultAction: action,
			errorText: errorText,
			countdownMs: countdownMs,
			// 第五轮修复 #2：把禁用过滤器传给 banner，禁用按钮置灰不可点
			isActionDisabled: isActionDisabled,
			onExecute: (chosenAction) => {
				// banner 已自带禁用过滤，到这里 chosenAction 必定可执行
				dispatchRecoveryAction(chosenAction, rule, ep, errorText, Date.now(), category);
			},
			onCancel: () => {
				recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'user-cancelled', result: 'cancelled' });
				lastRecoveryTs = Date.now();
				_recoveryCooldownMs = 15000;
			},
		});
	}

	// ── 动作: 自动重试 ──
	function handleRetryAction(rule, errorText, now, category) {
		const maxRetries = rule.maxRetries || settings.recoveryMaxRetries || 3;
		const baseDelay = rule.delay || settings.recoveryBaseDelay || 3000;

		const fingerprint = makeErrorFingerprint(errorText);
		if (fingerprint !== _lastErrorFingerprint) {
			if (recoveryRetryCount > 0) console.log(LOG_PREFIX + '[Recovery] 新错误，重置计数');
			recoveryRetryCount = 0;
			_lastErrorFingerprint = fingerprint;
		}
		if (recoveryRetryCount >= maxRetries) {
			console.log(LOG_PREFIX + '[Recovery] 达到最大重试 (' + maxRetries + ')');
			showRecoveryNotification('已达最大重试次数 (' + maxRetries + ')');
			recoveryRetryCount = 0;
			// 不清除 _lastErrorFingerprint，保留指纹防止 DOM 残留反复进入 retry 循环
			recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'retry', result: 'gave-up' });
			return;
		}
		recoveryRetryCount++;
		lastRecoveryTs = now;
		const delay = baseDelay * recoveryRetryCount;
		console.log(LOG_PREFIX + '[Recovery] ' + delay + 'ms 后重试 (' + recoveryRetryCount + '/' + maxRetries + ')');
		showRecoveryNotification(Math.round(delay / 1000) + 's 后重试...');
		recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'retry', result: 'scheduled', delay, attempt: recoveryRetryCount });
		setTimeout(() => {
			// 用户可能在 delay 期间关闭自动恢复或子开关 → 短路（避免违反用户意图）
			if (!settings.autoRecoveryEnabled) {
				console.log(LOG_PREFIX + '[Recovery] retry setTimeout 短路: autoRecoveryEnabled=false');
				return;
			}
			if (settings.guardian && settings.guardian.autoRetry === false) {
				console.log(LOG_PREFIX + '[Recovery] retry setTimeout 短路: guardian.autoRetry=false');
				return;
			}
			if (isInCooldown()) return;
			const retryBtn = findRetryButton();
			if (retryBtn) { markActionClick(); retryBtn.click(); bumpAcStat('retry'); }
		}, delay);
	}

	// ── 动作: 切换账号 ──
	function handleSwitchAccountAction(rule, ep, errorText, now, category) {
		lastRecoveryTs = now;
		recoveryRetryCount = 0;
		// 记住触发切号的错误指纹，防止 DOM 残留反复触发
		_lastSwitchFingerprint = makeErrorFingerprint(errorText);
		_lastSwitchTs = now;
		_recoveryCooldownMs = 30000;  // 切号后冷却 30s
		const signal = ep.signal || 'quota-exhausted';
		console.log(LOG_PREFIX + '[Recovery] 切换账号，信号=' + signal);
		recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'switch-account:' + signal, result: 'signal-sent' });
		bumpAcStat('switchAcct');
		sendPoolSignal(signal, lastUserMessage);
	}

	// ── 动作: 切换模型 ──
	function handleSwitchModelAction(rule, ep, errorText, now, category) {
		lastRecoveryTs = now;
		recoveryRetryCount = 0;
		// 记住触发指纹，防止 DOM 残留反复触发（包括降级切号场景）
		_lastSwitchFingerprint = makeErrorFingerprint(errorText);
		_lastSwitchTs = now;
		_recoveryCooldownMs = 30000;
		const modelPriority = rule.modelPriority || settings.recoveryRules.modelErrors.modelPriority || [];
		const afterAction = rule.afterAction || 'send-continue';
		if (modelPriority.length === 0) {
			console.log(LOG_PREFIX + '[Recovery] 无备选模型，尝试切号');
			// 降级为切号
			const signal = ep.signal || 'provider-unavailable';
			sendPoolSignal(signal, lastUserMessage);
			recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'switch-model', result: 'no-models-fallback-switch' });
			return;
		}
		showRecoveryNotification('模型不可用，尝试切换模型...');
		recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'switch-model', result: 'attempting' });
		bumpAcStat('switchModel');

		(async () => {
			const switched = await switchToNextModel(modelPriority);
			if (switched) {
				showRecoveryNotification('已切换到 ' + switched);
				recordRecoveryLog({ category, error: '', action: 'switch-model', result: 'switched:' + switched });
				// 切换后执行后续动作
				setTimeout(() => {
					if (!settings.autoRecoveryEnabled) {
						console.log(LOG_PREFIX + '[Recovery] switch-model afterAction setTimeout 短路: autoRecoveryEnabled=false');
						return;
					}
					executeAfterAction(afterAction);
				}, 1500);
			} else {
				// 所有模型都不可用，降级为切号
				console.log(LOG_PREFIX + '[Recovery] 模型切换失败，降级切号');
				const signal = ep.signal || 'provider-unavailable';
				sendPoolSignal(signal, lastUserMessage);
				recordRecoveryLog({ category, error: '', action: 'switch-model', result: 'failed-fallback-switch' });
			}
		})();
	}

	// ── 统一发送 continue 辅助函数（防重复 + 按钮提交） ──
	// 注意：test-send-continue 不走这里（直接调 setInputText/trySendMessage 以绕过总开关）
	async function sendContinueMessage(customText) {
		// 总开关：关闭自动继续时，任何路径都不发送（切号后、工具上限、无脑模式、守护面板均生效）
		if (settings.continueMode === 'off') {
			console.log(LOG_PREFIX + '[trigger] sendContinueMessage 被拦截: 自动继续已关闭 (continueMode=off)');
			return false;
		}
		const cooldown = (settings.sendCooldown && settings.sendCooldown > 0) ? settings.sendCooldown : 10000;
		if (Date.now() - _lastContinueTs < cooldown) return false;
		const text = customText || (settings.continueText && String(settings.continueText).trim()) || 'continue';

		// v6.6.1 关键修复：已有 queued 消息时，不再写入新文本+点按钮
		// 直接派发 Enter 触发 Windsurf 自己处理队列。
		// 用户反馈场景：配额耗尽 + 1 条"继续"已 queued + 输入框残留"继续" → 死锁
		// Windsurf DOM 上已经明示「按回车发送排队消息 (⏎)」，Enter 是官方推荐路径。
		if (hasQueuedMessage()) {
			const inputEl = findInputEl();
			if (inputEl) {
				dispatchEnterKey(inputEl);
				_lastContinueTs = Date.now();
				console.log(LOG_PREFIX, '[sendContinue] ✅ 已有 queued 消息 → 直接 Enter 触发队列（不重复入队）');
				bumpAcStat('sendMsg');
				// 等 Windsurf 处理一下队列
				await new Promise(r => setTimeout(r, 1500));
				return true;
			}
		}

		if (!await setInputText(text)) return false;
		_lastContinueTs = Date.now();
		markActionClick();
		// 等 Lexical 状态稳定后尝试发送
		await new Promise(r => setTimeout(r, 400));
		const method = trySendMessage();
		console.log(LOG_PREFIX, '[sendContinue] 尝试发送:', method);
		// 验证：等 1.5s 检查输入框是否被清空（真正发送成功 Windsurf 会自动清空输入框）
		await new Promise(r => setTimeout(r, 1500));
		const el = findInputEl();
		const remaining = (el?.textContent || '').trim();
		if (remaining.length > 0) {
			// v6.6.0 Bug C 修复：输入框残留可能是 queued 状态（消息已成功入队），不是真实失败
			// queued 状态下扩展不应清空输入框，否则会把 Windsurf 入队的消息抹掉
			if (hasQueuedMessage()) {
				console.log(LOG_PREFIX, '[sendContinue] ✅ 发送成功（消息已入队，不清空残留）');
				bumpAcStat('sendMsg');
				return true;
			}
			console.log(LOG_PREFIX, '[sendContinue] ⚠ 发送未生效（输入框仍有"' + remaining.substring(0, 20) + '"），清空残留');
			try { if (el) { el.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); } } catch {}
			return false;
		}
		console.log(LOG_PREFIX, '[sendContinue] ✅ 发送成功（输入框已清空）');
		bumpAcStat('sendMsg');
		return true;
	}

	// v6.6.2 终极修订（第四轮审查）：检测 Windsurf 是否处于 queued 状态
	//
	// 关键洞察：
	// 1. 汉化模块翻译每个 textNode 时把原英文存到父元素 data-ws-orig 属性
	// 2. AI 聊天消息体（[class*="markdown-body"] 等）在 EXCLUDE_SELECTOR 里被排除汉化
	//    → AI 消息体上不会有 data-ws-orig
	// 3. 全局扫 [data-ws-orig] 不会扫到聊天历史中的 AI 长对话
	//
	// 第四轮审查发现的新隐患（已修复）：
	// - 修复 A：data-ws-orig 累加只追加不删除，元素 textNode 变空时旧原文残留
	//   → 加可见性检查（getBoundingClientRect），过滤已隐藏的"幽灵"元素
	// - 修复 B：实测汉化条目最长 77 字符（"Queued messages will be sent one at a time..."）
	//   原 100 字符上限只有 23 字符余量；提升到 200 给累加机制留空间
	// - 修复 C：hint 正则 ^Enter 锚定在累加形态下漏匹配 → 去掉 ^ 锚定
	//
	// 当前方案：
	// - 主路径：全局扫 [data-ws-orig]，正则匹配 + 可见性检查 + 200 字符上限
	// - 兜底：汉化关闭时，从输入框上爬最多 3 层（严格不跨 chat-root）扫 innerText
	function hasQueuedMessage() {
		try {
			const QUEUED_EN_RE = /\d+\s+messages?\s+queued/i;
			const QUEUED_HINT_RE = /Enter to send queued message/i;  // 修复 C：去掉 ^ 锚定
			const QUEUED_CN_RE = /\d+\s*条消息排队/;

			// 主路径：全局扫 [data-ws-orig]
			const root = findChatRoot() || document.body;
			const origNodes = root.querySelectorAll('[data-ws-orig]');
			for (const n of origNodes) {
				const v = n.getAttribute('data-ws-orig');
				if (!v) continue;
				// 修复 B：200 字符上限（汉化最长条目 77 字符 × 2 + 累加换行 ≈ 156，留余量）
				if (v.length > 200) continue;
				if (!(QUEUED_EN_RE.test(v) || QUEUED_HINT_RE.test(v))) continue;
				// 修复 A：可见性检查——过滤已隐藏元素的 data-ws-orig 残留
				// 同一父元素 textNode 内容变化但元素不重建时，旧原文会留在 data-ws-orig
				// 真正的 queued indicator 一定可见；不可见的是 stale 数据
				try {
					const rect = n.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) continue;
				} catch {}
				return true;
			}

			// 兜底：汉化关闭 / 元素未被翻译时，扫输入框附近的 innerText
			// 严格限缩 3 层祖先（实测 Windsurf 输入框到 chat-root 通常 4-5 层，3 层一定不跨界）
			let scope = findInputEl();
			for (let i = 0; i < 3 && scope && scope.parentElement; i++) {
				scope = scope.parentElement;
			}
			if (scope) {
				const text = scope.innerText || '';
				// 长度上限：工具栏区域文本通常 < 2000 字符；超出说明已跨进消息区，不可信
				if (text.length < 2000) {
					if (QUEUED_EN_RE.test(text) || QUEUED_HINT_RE.test(text) || QUEUED_CN_RE.test(text)) {
						return true;
					}
				}
			}
			return false;
		} catch {
			return false;
		}
	}

	// ── 动作: 发送继续 ──
	function handleSendContinueAction(errorText, now, category) {
		lastRecoveryTs = now;
		const text = (settings.continueText && String(settings.continueText).trim()) || 'continue';
		console.log(LOG_PREFIX + '[Recovery] 自动发送 ' + text);
		recordRecoveryLog({ category, error: errorText.substring(0, 200), action: 'send-continue', result: 'sent' });
		sendContinueMessage();
	}

	let _lastContinueTs = 0;
	function checkForContinuePrompts() {
		if (settings.continueMode !== 'smart') return;
		// 守护面板「突破限制」开关关闭时不自动发送 continue
		if (settings.guardian && settings.guardian.autoSendOnToolLimit === false) return;
		if (Date.now() - _lastContinueTs < 15000) return;
		// 避免和 checkForErrors 在同一轮双重触发
		if (Date.now() - lastRecoveryTs < _recoveryCooldownMs) return;

		// 1) 按钮存在时跳过（由 autoContinue 模块处理按钮点击，此处只处理文本类截断）
		const btns = document.querySelectorAll('button, [role="button"]');
		for (const btn of btns) {
			const txt = (btn.textContent || '').trim();
			if (CONTINUE_BUTTON_TEXTS.includes(txt)) return;
		}

		// 2) 消息文本匹配（工具调用上限等 continuationErrors 模式）
		const contPatterns = ERROR_PATTERNS.filter(p => p.category === 'continuationErrors');
		if (contPatterns.length === 0) return;

		const scanRoot = getScanRoot();
		const seen = new Set();
		const candidates = [];
		for (const sel of CONT_MSG_SEL) {
			scanRoot.querySelectorAll(sel).forEach(el => {
				if (seen.has(el)) return;
				seen.add(el);
				candidates.push(el);
			});
		}
		const recent = candidates.slice(-30);
		for (const el of recent) {
			// 跳过已处理的元素
			if (el.dataset && el.dataset._wsContHandled) continue;
			// 排除 AI/用户消息体、代码编辑器、我们自己的 toast（同 getLatestErrorText 保持一致）
			if (el.closest(ASSISTANT_MSG_SEL)) continue;
			if (el.closest(USER_MSG_SEL)) continue;
			if (el.closest(IGNORED_CONTEXT_SEL)) continue;
			if (el.closest('#ws-recovery-toast,[id^="ws-"]')) continue;
			if (!isVisibleErrorElement(el)) continue;
			// 用 getElementErrorText 拿原文 + 可见文，让英文 pattern 在汉化后仍生效
			const txt = getElementErrorText(el);
			if (!txt || txt.length > 1000) continue;
			for (const cp of contPatterns) {
				if (cp.pattern.test(txt)) {
					try { el.dataset._wsContHandled = '1'; } catch {}
					const sendText = (settings.continueText && String(settings.continueText).trim()) || 'continue';
					console.log(LOG_PREFIX + '[Recovery] 工具上限/截断，自动发送 ' + sendText);
					recordRecoveryLog({ category: 'continuationErrors', error: txt.substring(0, 200), action: 'send-continue', result: 'sent' });
					sendContinueMessage();
					// v6.6.6：占用共享冷却，避免 checkForErrors 后续轮重弹无意义 banner
					lastRecoveryTs = Date.now();
					_recoveryCooldownMs = 15000;
					return;
				}
			}
		}
	}

	let _lastPermApprovalTs = 0;
	function checkForPermissionApproval(opts) {
		opts = opts || {};
		const rule = getRuleForCategory('permissionRequests') || {};
		// 守护面板「自动批准权限」总开关（测试按钮 force=true 时绕过）
		if (!opts.force) {
			if (settings.guardian && settings.guardian.autoApprovePermission === false) return;
			if (rule.action !== 'auto-allow') return;
		}
		// 3s 冷却，避免重复点击
		if (Date.now() - _lastPermApprovalTs < 3000) return;
		// guardian.permissionScope 优先，回退到 rule.scope
		const gdScope = settings.guardian && Array.isArray(settings.guardian.permissionScope) ? settings.guardian.permissionScope : null;
		const scopes = (gdScope && gdScope.length > 0) ? gdScope : (rule.scope || ['web-request']);

		const btns = document.querySelectorAll('button, [role="button"]');
		// 允许按钮文本白名单（精确匹配，覆盖"允许一次""Allow Once"等一次性放行变体；
		// 不匹配"不允许/deny/never/cancel"；也不自动点"始终允许/allow all"等永久性放行，避免越权）
		const ALLOW_TEXTS = new Set([
			'allow', '允许',
			'allow once', '允许一次', 'allow this time', '仅此一次',
			'approve', '批准',
			'accept', '接受',
			'run', '运行',
			'allow and run', '允许并运行',
		]);
		for (const btn of btns) {
			const txt = (btn.textContent || '').trim().toLowerCase();
			if (!txt) continue;
			// 明确排除否定/取消类按钮，避免 "不允许"/"don't allow" 这类误点
			if (txt.includes('不允许') || txt.includes('拒绝') || txt.includes('取消')
				|| txt.includes("don't allow") || txt.includes('deny') || txt.includes('cancel')
				|| txt.includes('never')) continue;
			const isAllow = ALLOW_TEXTS.has(txt);
			if (!isAllow) continue;

			// 检查上下文判断权限类型
			// 主路径：就近找已知容器 class；兜底路径：向上 6 层匹配文本特征（容忍 Windsurf UI 改版）
			let container = btn.closest('[class*="approval"], [class*="permission"], [class*="request"], [class*="dialog"], [class*="modal"], [class*="notification"]');
			if (!container) {
				let p = btn.parentElement;
				for (let i = 0; i < 6 && p; i++) {
					const pt = (p.textContent || '').toLowerCase();
					if (pt.includes('允许 web') || pt.includes('allow web')
						|| pt.includes('cascade wants') || pt.includes('cascade 想要')
						|| pt.includes('wants to fetch') || pt.includes('想要访问')
						|| pt.includes('wants to run') || pt.includes('wants to edit')
						|| pt.includes('wants to create') || pt.includes('wants to modify')) {
						container = p;
						break;
					}
					p = p.parentElement;
				}
			}
			if (!container) continue;
			const ctx = (container.textContent || '').toLowerCase();

			let matched = false;
			if (scopes.includes('web-request') && (ctx.includes('web') || ctx.includes('url') || ctx.includes('fetch') || ctx.includes('http'))) matched = true;
			if (scopes.includes('terminal') && (ctx.includes('terminal') || ctx.includes('command') || ctx.includes('execute') || ctx.includes('run'))) matched = true;
			if (scopes.includes('file-write') && (ctx.includes('file') || ctx.includes('write') || ctx.includes('create') || ctx.includes('edit') || ctx.includes('modify'))) matched = true;

			if (matched) {
				_lastPermApprovalTs = Date.now();
				console.log(LOG_PREFIX + '[Recovery] 自动批准权限请求: ' + txt);
				recordRecoveryLog({ category: 'permissionRequests', error: '', action: 'auto-allow', result: txt });
				bumpAcStat('permission');
				btn.click();
				return;
			}
		}
	}

	let recoveryPollTimer = null;
	// 启动冷静期：grace period 内不触发恢复，避免页面加载时把历史错误当新错误处理
	// 另外还要等 bridge 真正就绪（_bridgeReady），否则恢复时无法切号会显示"没连上插件"
	let _recoveryGraceUntil = 0;
	let _bridgeReady = false;
	let _recoveryEverStarted = false; // 是否曾经启动过（grace 只在首次启动时计算）
	const RECOVERY_GRACE_MS = 8000;

	function startAutoRecovery() {
		if (recoveryObserver) { recoveryObserver.disconnect(); recoveryObserver = null; }
		if (recoveryPollTimer) { clearInterval(recoveryPollTimer); recoveryPollTimer = null; }
		if (!settings.autoRecoveryEnabled) return;

		// 进入启动冷静期：grace period 内只跟踪不触发
		// 仅首次启动（而非用户开关切换）才重置 grace，避免用户切开关误屏蔽真实错误
		if (!_recoveryEverStarted) {
			_recoveryGraceUntil = Date.now() + RECOVERY_GRACE_MS;
			// 仅预标记"独立错误容器"——不动 assistant 消息内部，否则会屏蔽用户当前未处理的真实错误
			// assistant 内嵌错误依靠 grace period + cooldown + 指纹去重三重防护即可
			try {
				const scanRoot = getScanRoot();
				scanRoot.querySelectorAll('[role="alert"], [role="status"]').forEach(el => {
					if (el.closest(ASSISTANT_MSG_SEL)) return; // 跳过 assistant 内部
					try { if (el.dataset) el.dataset._wsRecoveryHandled = '1'; } catch {}
				});
				console.log(LOG_PREFIX + '[Recovery] 启动冷静期预标记完成，' + RECOVERY_GRACE_MS + 'ms 内忽略所有错误');
			} catch (e) {
				console.warn(LOG_PREFIX + '[Recovery] 预标记失败:', e);
			}
			_recoveryEverStarted = true;
		}

		// MutationObserver 驱动错误检测
		let debounceTimer = null;
		recoveryObserver = new MutationObserver(() => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				// 启动冷静期内或 bridge 未就绪时，只做跟踪，不触发恢复
				if (Date.now() < _recoveryGraceUntil || !_bridgeReady) {
					trackLastUserMessage();
					return;
				}
				trackLastUserMessage();
				checkForErrors();
				checkForContinuePrompts();
				checkForPermissionApproval();
				checkForPoolResult();
			}, 500);
		});
		recoveryObserver.observe(document.body, { childList: true, subtree: true });

		// 定时轮询 pool result（兜底）
		recoveryPollTimer = setInterval(() => {
			if (settings.autoRecoveryEnabled) checkForPoolResult();
		}, 3000);

		console.log(LOG_PREFIX + '[Recovery] ✅自动恢复已启用（' + RECOVERY_GRACE_MS + 'ms 启动冷静期）');
	}

	// ========== 完成提醒 ==========
	const TONE_PRESETS = {
		funk: [
			{ freq: 587.33, dur: 0.12 }, // D5
			{ freq: 783.99, dur: 0.12 }, // G5
			{ freq: 880.00, dur: 0.18 }, // A5
		],
		ding: [
			{ freq: 880, dur: 0.25 },    // A5
		],
		chime: [
			{ freq: 659.25, dur: 0.1 },  // E5
			{ freq: 783.99, dur: 0.1 },  // G5
			{ freq: 987.77, dur: 0.2 },  // B5
		],
		beep: [
			{ freq: 1000, dur: 0.15 },
			{ freq: 0, dur: 0.05 },
			{ freq: 1000, dur: 0.15 },
		],
	};

	let _audioCtx = null;
	function getAudioCtx() {
		if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		return _audioCtx;
	}

	function playTone(toneName) {
		try {
			const ctx = getAudioCtx();
			// 自动恢复挂起的 AudioContext（浏览器自动播放策略）
			if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
				ctx.resume().catch(() => {});
			}
			const notes = TONE_PRESETS[toneName] || TONE_PRESETS.funk;
			let t = ctx.currentTime;
			notes.forEach(n => {
				if (n.freq > 0) {
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();
					osc.type = 'sine';
					osc.frequency.value = n.freq;
					gain.gain.setValueAtTime(0.3, t);
					gain.gain.exponentialRampToValueAtTime(0.01, t + n.dur);
					osc.connect(gain);
					gain.connect(ctx.destination);
					osc.start(t);
					osc.stop(t + n.dur);
				}
				t += n.dur;
			});
		} catch (e) {
			console.warn(LOG_PREFIX + '[Notify] 播放失败:', e);
		}
	}

	function playNotifySound() {
		const repeat = Math.max(1, Math.min(5, settings.notifyRepeat || 2));
		const tone = settings.notifyTone || 'funk';
		const notes = TONE_PRESETS[tone] || TONE_PRESETS.funk;
		const duration = notes.reduce((s, n) => s + n.dur, 0);
		const gap = 0.6; // 间隔 ~600ms
		for (let i = 0; i < repeat; i++) {
			setTimeout(() => playTone(tone), i * (duration + gap) * 1000);
		}
	}

	function sendDesktopNotify(title, body) {
		try {
			if (Notification.permission === 'granted') {
				new Notification(title, { body, icon: '' });
			} else if (Notification.permission !== 'denied') {
				Notification.requestPermission().then(p => {
					if (p === 'granted') new Notification(title, { body });
				});
			}
		} catch {}
	}

	// ========== 无脑模式：AI 停止 N 秒后自动发"继续" ==========
	let brainlessTimer = null;
	let _brainlessLastLen = 0;
	let _brainlessLastChangeTs = 0;
	let _brainlessConsecutive = 0;
	let _brainlessLastFireTs = 0;

	function getLastAssistantText() {
		// 抓最后一条 assistant 消息的文本长度作为 idle 判定依据
		const root = getScanRoot();
		// 优先用标准选择器
		let candidates = root.querySelectorAll(ASSISTANT_MSG_SEL);
		if (candidates.length === 0) {
			// 回退：扫描整个聊天区域的文本长度（Windsurf DOM 可能无 data-role 属性）
			return root.textContent || '';
		}
		const last = candidates[candidates.length - 1];
		return last ? (last.textContent || '') : '';
	}

	// 权限按钮关键词（中英双语；汉化模式下按钮文本会被改成中文，要同时匹配两边）
	const PERMISSION_KEYWORDS_EN = ['accept all', 'always allow', 'allow this conversation', 'approve', 'reject all', 'reject'];
	const PERMISSION_KEYWORDS_ZH = ['全部接受', '全部拒绝', '始终允许', '允许此对话', '授权', '允许', '批准', '拒绝'];

	function hasPermissionPrompt() {
		const btns = document.querySelectorAll('button, [role="button"]');
		for (const b of btns) {
			// 1) 可见文本（汉化后是中文）
			const visible = (b.textContent || '').trim();
			const lower = visible.toLowerCase();
			for (const kw of PERMISSION_KEYWORDS_EN) {
				if (lower.includes(kw)) return true;
			}
			for (const kw of PERMISSION_KEYWORDS_ZH) {
				if (visible.includes(kw)) return true;
			}
			// 2) data-ws-orig 原文（汉化前的英文，自身或子元素）
			const selfOrig = b.getAttribute && b.getAttribute('data-ws-orig');
			if (selfOrig) {
				const lo = selfOrig.toLowerCase();
				for (const kw of PERMISSION_KEYWORDS_EN) if (lo.includes(kw)) return true;
			}
		}
		return false;
	}

	// AI 生成中按钮的关键词集合（精确等于匹配，避免误判）
	const GENERATING_KEYWORDS = new Set([
		'stop', 'cancel', 'abort',
		'停止', '取消', '终止', '中止', '中断',
	]);

	// 记录上一次检测到的 thumbs-up 数量（用于信号2判断是否有新消息在生成）
	let _lastThumbsCount = 0;
	let _expectingResponse = false;

	function isAIGenerating() {
		const chatRoot = document.querySelector('.chat-client-root') || document;
		// 信号1: 输入框旁的按钮图标 = lucide-circle-stop → 生成中
		if (chatRoot.querySelector('svg.lucide-circle-stop')) return true;
		// 信号2: 操作栏（👍👎📋）数量检测
		// 每条 AI 回复完成后才渲染 lucide-thumbs-up，生成中没有
		const thumbs = chatRoot.querySelectorAll('svg.lucide-thumbs-up');
		const currentCount = thumbs.length;
		if (_expectingResponse) {
			if (currentCount < _lastThumbsCount) {
				// 数量减少 = 用户切换了对话，重置状态避免卡死
				_expectingResponse = false;
				_lastThumbsCount = currentCount;
			} else if (currentCount === _lastThumbsCount) {
				return true; // 数量没增加 = AI 还在生成
			} else {
				_expectingResponse = false; // 数量增加 = 回复已完成
			}
		}
		return false;
	}

	// 长任务发送后调用：记录当前 thumbs-up 数量，标记等待新回复
	function markExpectingNewResponse() {
		const chatRoot = document.querySelector('.chat-client-root') || document;
		const thumbs = chatRoot.querySelectorAll('svg.lucide-thumbs-up');
		_lastThumbsCount = thumbs.length;
		_expectingResponse = true;
	}

	// 等待 AI 停止生成后执行回调（轮询 1s，最多 maxWait ms）
	function waitForAIIdle(callback, maxWait) {
		maxWait = maxWait || 120000;
		const start = Date.now();
		function poll() {
			if (Date.now() - start > maxWait) {
				console.log(LOG_PREFIX + '[waitForAIIdle] 超时 ' + (maxWait / 1000) + 's，强制执行');
				callback();
				return;
			}
			if (isAIGenerating()) {
				setTimeout(poll, 1000);
				return;
			}
			// AI 已空闲，再等 1s 确认稳定
			setTimeout(() => {
				if (isAIGenerating()) {
					setTimeout(poll, 1000);
				} else {
					callback();
				}
			}, 1000);
		}
		// 首次立即检查
		if (!isAIGenerating()) {
			callback();
		} else {
			console.log(LOG_PREFIX + '[waitForAIIdle] AI 正在生成，开始轮询等待...');
			setTimeout(poll, 1000);
		}
	}

	// ── 队列状态 + 停止辅助 ──
	let _brainlessQueueIndex = 0;
	let _brainlessSendFailCount = 0;

	function stopBrainlessMode(reason) {
		if (brainlessTimer) { clearInterval(brainlessTimer); brainlessTimer = null; }
		console.log(LOG_PREFIX + '[Brainless] 停止: ' + reason);
		showRecoveryNotification('长任务已停止: ' + reason);
		// 恢复守护模式：continueMode 回到 smart，重启 autoContinue
		// 避免长任务因错误/上限停止后，自动续写和突破限制功能静默失效
		settings.continueMode = 'smart';
		try { saveSettings(settings); } catch {}
		startAutoContinue();
		// 通知侧栏更新状态
		bridgePostResult({ action: 'lt-stopped', reason, count: _brainlessConsecutive });
	}

	function getNextQueueText() {
		const lt = settings.longTask || {};
		const queue = (Array.isArray(lt.continueQueue) && lt.continueQueue.length > 0)
			? lt.continueQueue
			: [(settings.continueText || 'continue')];
		const loop = lt.loop !== false;

		if (_brainlessQueueIndex >= queue.length) {
			if (loop) {
				_brainlessQueueIndex = 0;
			} else {
				return null; // 队列已耗尽
			}
		}
		const text = (queue[_brainlessQueueIndex] || 'continue').trim();
		_brainlessQueueIndex++;
		return text;
	}

	async function fireBrainlessContinue() {
		// 模式保护：clearInterval 和回调执行可能交叉，确保已切走时不多发
		if (settings.continueMode !== 'brainless') return;
		const now = Date.now();
		// 长任务模式冷却 = 用户设置的空闲等待时间（界面显示多少就是多少）
		const idleSec = (settings.longTask && settings.longTask.idleSeconds) || settings.brainlessIdleSeconds || 8;
		const sendCd = idleSec * 1000;
		if (now - _brainlessLastFireTs < sendCd) return;

		// 守护模式正在处理中（切号/切模型冷却期内）→ 暂不发送
		if (now - _lastSwitchTs < 60000 && now - lastRecoveryTs < _recoveryCooldownMs) {
			console.log(LOG_PREFIX + '[Brainless] 守护模式处理中（切号/切模型），暂停发送');
			_brainlessLastChangeTs = now;
			return;
		}

		// 错误检测：检查是否有需要守护模式处理的错误
		const { text: errorText } = getLatestErrorText();
		if (errorText) {
			for (const ep of ERROR_PATTERNS) {
				if (!ep.pattern.test(errorText)) continue;
				if (ep.category === 'userIntervention') {
					// F 类：需要用户介入 → 停止长任务
					const stopOnF = !(settings.longTask && settings.longTask.stopOnUserIntervention === false);
					if (stopOnF) { stopBrainlessMode(ep.hint || '需要用户介入'); return; }
				}
				if (ep.category === 'quotaErrors' || ep.category === 'modelErrors' || ep.category === 'networkErrors') {
					// C/D/B 类：让守护模式处理（换号/切模型/重试），长任务暂不发送
					console.log(LOG_PREFIX + '[Brainless] 检测到 [' + ep.category + '] 错误，等待守护模式处理');
					_brainlessLastChangeTs = now;
					return;
				}
				break;
			}
		}

		// 防止无限循环：如果输入框已有文本（上次发送失败残留），记录失败并清空
		// v6.6.1：queued 状态下不是"失败"，是 Windsurf 在排队等发送
		// → 直接 Enter 触发队列处理，而不是傻等下一轮
		const existingInput = findInputEl();
		if (existingInput && (existingInput.textContent || '').trim().length > 0) {
			if (hasQueuedMessage()) {
				console.log(LOG_PREFIX + '[Brainless] 输入框有内容 + queued 状态 → 派发 Enter 推动队列');
				dispatchEnterKey(existingInput);
				_brainlessLastChangeTs = now;
				_brainlessLastFireTs = now;  // 占用冷却避免立刻又触发
				return;
			}
			_brainlessSendFailCount++;
			console.log(LOG_PREFIX + '[Brainless] 输入框残留，发送失败 #' + _brainlessSendFailCount);
			try { existingInput.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); } catch {}
			const maxFail = (settings.longTask && settings.longTask.maxSendRetries) || 3;
			if (_brainlessSendFailCount >= maxFail) {
				stopBrainlessMode('发送失败(连续' + _brainlessSendFailCount + '次)');
			}
			return;
		}

		if (settings.brainlessSkipPermission && hasPermissionPrompt()) {
			console.log(LOG_PREFIX + '[Brainless] 检测到权限提示，跳过');
			return;
		}

		// 最大继续次数检查（0 = 无限）
		const maxCount = (settings.longTask && settings.longTask.maxContinueCount) || settings.brainlessMaxConsecutive || 0;
		if (maxCount > 0 && _brainlessConsecutive >= maxCount) {
			stopBrainlessMode('达到最大继续次数(' + maxCount + ')');
			return;
		}

		// 队列取下一条文本
		const text = getNextQueueText();
		if (text === null) {
			stopBrainlessMode('队列已消费完');
			return;
		}

		_brainlessLastFireTs = now;
		_brainlessConsecutive++;
		console.log(LOG_PREFIX + '[Brainless] 🤖 自动发送"' + text + '" (#' + _brainlessConsecutive + ')');

		try {
			const sent = await sendContinueMessage(text);
			if (sent) {
				_brainlessSendFailCount = 0;
				markExpectingNewResponse(); // 标记等待新回复，信号2开始检测
				// 推送计数到侧栏
				bridgePostResult({ action: 'lt-count', count: _brainlessConsecutive, text });
				// v6.6.0 Bug B 修复：发送后 3s 主动 poll 错误，不等下一轮 idle
				// 避免"发完继续 → 立刻报错（如配额耗尽）→ 8s 后才反应"的死锁
				setTimeout(() => {
					try {
						const { text: errText2 } = getLatestErrorText();
						if (errText2) {
							console.log(LOG_PREFIX + '[Brainless] 发送后 3s 主动检测错误: ' + errText2.substring(0, 100));
							checkForErrors();
						}
					} catch (e) {
						console.warn(LOG_PREFIX + '[Brainless] 主动错误检测异常:', e);
					}
				}, 3000);
			} else {
				_brainlessSendFailCount++;
				_brainlessQueueIndex--; // 发送失败，队列指针回退
				const maxFail = (settings.longTask && settings.longTask.maxSendRetries) || 3;
				if (_brainlessSendFailCount >= maxFail) {
					stopBrainlessMode('发送失败(连续' + _brainlessSendFailCount + '次)');
				}
			}
		} catch (e) {
			console.warn(LOG_PREFIX + '[Brainless] 发送异常:', e);
		}
	}

	function startBrainlessMode() {
		if (brainlessTimer) { clearInterval(brainlessTimer); brainlessTimer = null; }
		if (settings.continueMode !== 'brainless') return;
		console.log(LOG_PREFIX + '[Brainless] ✅已启用，idle=' + ((settings.longTask && settings.longTask.idleSeconds) || settings.brainlessIdleSeconds || 8) + 's');
		_brainlessQueueIndex = 0;
		_brainlessSendFailCount = 0;
		_brainlessLastFireTs = 0; // 重置冷却，让第一次发送不被阻塞
		_brainlessLastLen = (getLastAssistantText() || '').length;
		_brainlessLastChangeTs = Date.now();
		brainlessTimer = setInterval(() => {
			if (settings.continueMode !== 'brainless') return;
			// AI 正在生成 → 重置计时器
			if (isAIGenerating()) {
				_brainlessLastChangeTs = Date.now();
				_brainlessConsecutive = 0;  // 用户/AI 有动作 → 重置连续计数
				return;
			}
			const text = getLastAssistantText();
			if (text.length !== _brainlessLastLen) {
				_brainlessLastLen = text.length;
				_brainlessLastChangeTs = Date.now();
				return;
			}
			// 内容不变 + 不在生成 → 检查 idle 时长
			const idleMs = ((settings.longTask && settings.longTask.idleSeconds) || settings.brainlessIdleSeconds || 8) * 1000;
			if (Date.now() - _brainlessLastChangeTs >= idleMs) {
				fireBrainlessContinue();
				_brainlessLastChangeTs = Date.now();  // 触发后重置，避免连续狂发
			}
		}, 2000);
	}

	let notifyObserver = null;
	let _lastAssistantCount = 0;
	let _wasGenerating = false;

	function startNotifyObserver() {
		if (notifyObserver) { notifyObserver.disconnect(); notifyObserver = null; }
		if (!settings.notifyEnabled) return;

		// 初始计数
		_lastAssistantCount = getScanRoot().querySelectorAll(ASSISTANT_MSG_SEL).length;
		_wasGenerating = false;

		// ── 方法 A：拦截 Windsurf 原生 Notification API（最可靠） ──
		if (!window._wsNotifyHooked) {
			window._wsNotifyHooked = true;
			const OrigNotification = window.Notification;
			window.Notification = function(title, options) {
				// 检测 Windsurf 的完成通知（标题含 "Cascade" 或 "完成"）
				const titleLower = (title || '').toLowerCase();
				if (titleLower.includes('cascade') || titleLower.includes('完成') || titleLower.includes('complete')) {
					console.log(LOG_PREFIX + '[Notify] 🎯 拦截到 Windsurf 原生完成通知: ' + title);
					triggerNotifySound();
				}
				return new OrigNotification(title, options);
			};
			window.Notification.permission = OrigNotification.permission;
			window.Notification.requestPermission = OrigNotification.requestPermission.bind(OrigNotification);
			Object.defineProperty(window.Notification, 'permission', {
				get: () => OrigNotification.permission
			});
			console.log(LOG_PREFIX + '[Notify] Notification API 已挂钩');
		}

		// ── 方法 B：MutationObserver + 轮询（兜底） ──
		let debounceTimer = null;
		notifyObserver = new MutationObserver(() => {
			if (!settings.notifyEnabled) return;
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => checkCompletion(), 800);
		});
		notifyObserver.observe(document.body, { childList: true, subtree: true });
		if (window._notifyPollTimer) clearInterval(window._notifyPollTimer);
		window._notifyPollTimer = setInterval(() => {
			if (!settings.notifyEnabled) return;
			checkCompletion();
		}, 2000);
		console.log(LOG_PREFIX + '[Notify] ✅完成提醒已启用（Notification hook + 观察器 + 轮询）');
	}

	// 直接触发声音提醒（被 Notification hook 或 checkCompletion 调用）
	let _lastTriggerTs = 0;
	function triggerNotifySound() {
		if (!settings.notifyEnabled) return;
		// 防抖：8s 内不重复触发（避免多检测方法重复播放）
		if (Date.now() - _lastTriggerTs < 8000) return;
		_lastTriggerTs = Date.now();

		const shouldNotify = shouldTriggerNotify();
		if (!shouldNotify) return;

		console.log(LOG_PREFIX + '[Notify] 触发提醒（sound=' + !!settings.notifySound + '）');
		// 仅走 HTTP 桥 → 扩展后端播放系统声音（唯一路径，避免重复）
		try {
			if (typeof bridgePostResult === 'function' && typeof getBridgeUrl === 'function' && getBridgeUrl()) {
				bridgePostResult({
					type: 'notify-sound',
					ts: Date.now(),
					sound: !!settings.notifySound,
					desktop: false,
					tone: settings.notifyTone || 'funk',
					repeat: settings.notifyRepeat || 1,
					customTone: settings.customTone || '',
					audioFile: settings.audioFile || '',
				});
			}
		} catch(e) {
			console.warn(LOG_PREFIX + '[Notify] bridge 发送失败:', e);
		}
	}

	// 完成提醒：综合检测 AI 生成状态
	// 方法1: isAIGenerating()（lucide-circle-stop + thumbs-up）
	// 方法2: 文本增长检测（兜底，不依赖特定 DOM class）
	let _notifyLastTextLen = 0;
	let _notifyTextStableCount = 0; // 文本稳定的连续检测次数
	let _notifyTextGrowing = false; // 文本是否在增长中

	function isNotifyGenerating() {
		// 优先用 isAIGenerating()（如果停止按钮存在则可靠）
		if (isAIGenerating()) return true;

		// 兜底：检测聊天区域文本是否在增长（不依赖特定 assistant 选择器）
		try {
			const scanRoot = getScanRoot();
			// 先尝试 assistant 消息选择器
			let msgs = scanRoot.querySelectorAll(ASSISTANT_MSG_SEL);
			let curLen = 0;
			if (msgs.length > 0) {
				curLen = (msgs[msgs.length - 1].textContent || '').length;
			} else {
				// 回退到整个聊天区域的文本长度
				curLen = (scanRoot.textContent || '').length;
			}

			if (curLen > _notifyLastTextLen + 3) {
				// 文本在增长
				_notifyLastTextLen = curLen;
				_notifyTextStableCount = 0;
				_notifyTextGrowing = true;
				return true;
			} else if (_notifyTextGrowing) {
				// 文本曾经增长但现在稳定了
				_notifyTextStableCount++;
				_notifyLastTextLen = curLen;
				// 需要连续 2 次检测（轮询 2s × 2 = ~4s）文本不变才判定为停止
				if (_notifyTextStableCount < 2) return true;
				// 稳定了 → 生成结束
				_notifyTextGrowing = false;
				_notifyTextStableCount = 0;
				return false;
			}
			_notifyLastTextLen = curLen;
		} catch(e) {}

		return false;
	}

	function checkCompletion() {
		if (!settings.notifyEnabled) return;
		const generating = isNotifyGenerating();

		// 状态跳变日志（只在跳变时打印，避免刷屏）
		if (generating !== _wasGenerating) {
			console.log(LOG_PREFIX + '[Notify] 状态跳变: ' + _wasGenerating + ' → ' + generating);
		}

		if (_wasGenerating && !generating) {
			// 刚刚从生成状态变为非生成状态 → 完成
			console.log(LOG_PREFIX + '[Notify] 检测到完成（方法B：文本增长检测）');
			triggerNotifySound();
		}
		
		_wasGenerating = generating;
		// 更新助手消息计数
		_lastAssistantCount = getScanRoot().querySelectorAll(ASSISTANT_MSG_SEL).length;
	}

	function shouldTriggerNotify() {
		const trigger = settings.notifyTrigger || 'always';
		switch (trigger) {
			case 'always': return true;
			case 'error': {
				// 仅在有错误时触发
				const { text } = getLatestErrorText();
				if (!text) return false;
				for (const ep of ERROR_PATTERNS) { if (ep.pattern.test(text)) return true; }
				return false;
			}
			case 'idle': {
				// 仅在窗口不活跃时触发
				return document.hidden || !document.hasFocus();
			}
			default: return true;
		}
	}
	
	// ========== 桥（Bridge HTTP Client）==========
	// 替代旧的 localStorage 跨 origin 通信（不工作）。扩展宿主起 localhost HTTP server。
	// 多实例关键：workbench.html 是全部实例共享的单一文件，不能注入单一端口。
	// 端口/token 改由同进程 sidebar webview iframe 通过 window.postMessage 推送：
	//   { type: 'ws-pool-bridge', port, token }
	// 这样"sidebar iframe ↔ workbench 顶层 frame"天然与进程绑定，不会跨实例串号。
	let _bridgeInfo = null;
	try {
		window.addEventListener('message', (e) => {
			const d = e && e.data;
			if (!d || d.type !== 'ws-pool-bridge') return;
			const port = Number(d.port);
			const token = String(d.token || '');
			if (!port || !token) return;
			const changed = !_bridgeInfo || _bridgeInfo.port !== port || _bridgeInfo.token !== token;
			_bridgeInfo = { port, token };
			if (changed) {
				console.log(LOG_PREFIX + '[bridge] received from sidebar: port=' + port);
				// 端口变化 → 清掉旧轮询计时器再重启
				if (_bridgePollTimer) { clearInterval(_bridgePollTimer); _bridgePollTimer = null; }
				startBridgePolling();
			}
		});
	} catch (e) { console.warn(LOG_PREFIX + '[bridge] message listener failed:', e); }
	function getBridgeUrl() {
		if (!_bridgeInfo || !_bridgeInfo.port) return null;
		return 'http://127.0.0.1:' + _bridgeInfo.port;
	}
	function getBridgeHeaders() {
		return {
			'Content-Type': 'application/json',
			'X-Bridge-Token': (_bridgeInfo && _bridgeInfo.token) || '',
		};
	}
	async function bridgePostResult(payload) {
		const base = getBridgeUrl();
		if (!base) return;
		try {
			const ctrl = new AbortController();
			const tid = setTimeout(() => ctrl.abort(), 5000);
			await fetch(base + '/result', {
				method: 'POST',
				headers: getBridgeHeaders(),
				body: JSON.stringify(payload),
				signal: ctrl.signal,
			});
			clearTimeout(tid);
		} catch (e) {
			if (e.name !== 'AbortError') console.warn(LOG_PREFIX + '[bridge] POST /result failed:', e);
		}
	}
	let _bridgePollFailStreak = 0;
	async function bridgePoll() {
		const base = getBridgeUrl();
		if (!base) return [];
		try {
			const ctrl = new AbortController();
			const tid = setTimeout(() => ctrl.abort(), 5000);
			const res = await fetch(base + '/pending', { method: 'GET', headers: getBridgeHeaders(), signal: ctrl.signal });
			clearTimeout(tid);
			if (!res.ok) {
				_bridgePollFailStreak++;
				if (_bridgePollFailStreak >= 3 && _bridgeReady) {
					_bridgeReady = false;
					console.warn(LOG_PREFIX + '[bridge] 连续 3 次响应非 200，标记为未就绪');
				}
				return [];
			}
			_bridgePollFailStreak = 0;
			if (!_bridgeReady) {
				_bridgeReady = true;
				console.log(LOG_PREFIX + '[bridge] 心跳恢复，重新标记为就绪');
			}
			return await res.json();
		} catch (e) {
			_bridgePollFailStreak++;
			if (_bridgePollFailStreak >= 3 && _bridgeReady) {
				_bridgeReady = false;
				console.warn(LOG_PREFIX + '[bridge] 连续 3 次连接失败，标记为未就绪');
			}
			return [];
		}
	}
	let _bridgePollTimer = null;
	async function _waitBridgeReady() {
		const base = getBridgeUrl();
		if (!base) return false;
		// 间隔 1s 探测，最多 30 次（30s）。fetch 失败浏览器会打 ERR_CONNECTION_REFUSED，
		// 但相比每 500ms 失败一次，频率减半且更短促。
		for (let i = 0; i < 30; i++) {
			try {
				const res = await fetch(base + '/ping', { method: 'GET', headers: getBridgeHeaders() });
				if (res.ok) return true;
			} catch {}
			await new Promise(r => setTimeout(r, 1000));
		}
		return false;
	}
	async function startBridgePolling() {
		if (_bridgePollTimer) return;
		if (!getBridgeUrl()) {
			console.log(LOG_PREFIX + '[bridge] 未配置端口，跳过轮询');
			return;
		}
		const ready = await _waitBridgeReady();
		if (!ready) {
			console.warn(LOG_PREFIX + '[bridge] 等待 bridge 超时，仍开始轮询');
		} else {
			console.log(LOG_PREFIX + '[bridge] ✅就绪，启动命令轮询');
		}
		// 标记 bridge 就绪（无论超时与否都置 true，超时后仍尝试轮询）
		_bridgeReady = true;
		// bridge 就绪后立即推送一次日志，并定期 60s 同步，确保 globalState 始终有最新数据
		if (_logSyncIntervalTimer) { clearInterval(_logSyncIntervalTimer); _logSyncIntervalTimer = null; }
		setTimeout(() => _pushLogsTobridge(), 1000);
		_logSyncIntervalTimer = setInterval(() => _pushLogsTobridge(), 60000);
		const tick = async () => {
			const pending = await bridgePoll();
			for (const cmd of pending) {
				try { await handleSidebarCommand(cmd); } catch (e) { console.warn(LOG_PREFIX + '[bridge] handle err:', e); }
			}
		};
		_bridgePollTimer = setInterval(tick, 500);
		tick();
	}

	// ========== 侧栏命令处理 ==========
	async function handleSidebarCommand(cmd) {
		// webview 通过 sendCommand(action, extra) 发命令时把参数包在 payload 里
		// 为了兼容历史代码（直接读 cmd.model / cmd.text 等），统一在入口平铺到顶层
		if (cmd && cmd.payload && typeof cmd.payload === 'object') {
			for (const k in cmd.payload) {
				if (!(k in cmd)) cmd[k] = cmd.payload[k];
			}
		}
		console.log(LOG_PREFIX + '[cmd] 收到 action=' + cmd.action + ' id=' + cmd.id);
		const respond = (result) => {
			console.log(LOG_PREFIX + '[cmd] 响应 action=' + cmd.action + ' id=' + cmd.id + ' status=' + result.status);
			bridgePostResult({
				id: cmd.id, action: cmd.action, ts: Date.now(), ...result
			});
		};

		switch (cmd.action) {
			case 'force-stop': {
				// 强制停止长任务：清除 brainless 定时器 + 清空输入框（不影响守护模式 observer）
				if (brainlessTimer) { clearInterval(brainlessTimer); brainlessTimer = null; }
				// 清空输入框残留
				try {
					const el = findInputEl();
					if (el && (el.textContent || '').trim()) {
						el.focus();
						document.execCommand('selectAll', false, null);
						document.execCommand('delete', false, null);
					}
				} catch {}
				// 重置状态
				_brainlessConsecutive = 0;
				_brainlessQueueIndex = 0;
				_brainlessSendFailCount = 0;
				respond({ status: 'done', message: '已强制停止' });
				break;
			}
			case 'pool-result': {
				// 反向命令：扩展宿主切号结果回传 → 写 localStorage 让 checkForPoolResult 处理
				try {
					if (cmd.payload) {
						localStorage.setItem('ws-pool-result', JSON.stringify(cmd.payload));
						console.log(LOG_PREFIX + '[trigger] bridge收到pool-result: type=' + cmd.payload.type + (cmd.payload.email ? ' email=' + cmd.payload.email : '') + (cmd.payload.error ? ' error=' + cmd.payload.error : ''));
						console.log(LOG_PREFIX + '[Recovery] 收到 bridge 切号结果: ' + cmd.payload.type);
					}
				} catch {}
				break;
			}
			case 'apply-settings': {
				// 反向命令：侧栏 webview 改设置后实时推送过来，避免 reload
				try {
					if (cmd.payload && typeof cmd.payload === 'object') {
						applySettingsChange(cmd.payload, '[bridge apply-settings]');
					}
				} catch (err) {
					console.warn(LOG_PREFIX + '[apply-settings] 失败:', err);
				}
				break;
			}
			case 'clear-recovery-prefs': {
				// v6.6.0：清除已学习的恢复偏好
				try {
					clearAllRecoveryPrefs();
					respond({ status: 'done', message: '已清除所有恢复偏好' });
					console.log(LOG_PREFIX + '[Recovery] 偏好已清除（来自侧栏）');
				} catch (err) {
					respond({ status: 'error', message: '清除失败: ' + (err.message || err) });
				}
				break;
			}
			case 'syncLogs': {
				// 同步日志到扩展 globalState（供全屏统计面板使用）
				try {
					let recoveryLogs = [];
					let diagnoseLogs = [];
					try {
						const rawRecovery = localStorage.getItem('ws-recovery-log');
						if (rawRecovery) recoveryLogs = JSON.parse(rawRecovery) || [];
					} catch {}
					try {
						const rawDiagnose = localStorage.getItem('ws-diagnose-log');
						if (rawDiagnose) diagnoseLogs = JSON.parse(rawDiagnose) || [];
					} catch {}
					respond({ status: 'done', payload: { recoveryLogs, diagnoseLogs } });
					console.log(LOG_PREFIX + '[syncLogs] 已同步 ' + recoveryLogs.length + ' 条恢复日志, ' + diagnoseLogs.length + ' 条诊断日志');
				} catch (err) {
					respond({ status: 'error', message: '同步失败: ' + (err.message || err) });
				}
				break;
			}
			case 'fetch-models': {
				respond({ status: 'running' });
				try {
					const panelOpened = cmd.payload && cmd.payload._panelOpened;
					const models = await getAvailableModels(panelOpened);
					const current = getCurrentModelName();
					respond({ status: 'done', models, currentModel: current });
				} catch (err) {
					respond({ status: 'error', message: '获取模型失败: ' + (err.message || err) });
				}
				break;
			}
			case 'test-switch-model': {
				const target = cmd.model;
				if (!target) { respond({ status: 'error', message: '未指定模型' }); return; }
				respond({ status: 'running', message: '正在切换到 ' + target + '...' });
				try {
					const ok = await switchModel(target);
					const newModel = getCurrentModelName();
					respond({ status: ok ? 'done' : 'error', message: ok ? '已切换到 ' + (newModel || target) : '切换失败: ' + target, newModel });
				} catch (err) {
					respond({ status: 'error', message: '切换异常: ' + (err.message || err) });
				}
				break;
			}
			case 'test-retry': {
				const retryBtn = findRetryButton();
				if (retryBtn) {
					respond({ status: 'done', message: '找到重试按钮并点击' });
					retryBtn.click();
				} else {
					respond({ status: 'error', message: '未找到重试按钮（当前可能没有错误）' });
				}
				break;
			}
			case 'test-send-continue': {
				const text = (cmd.text && String(cmd.text).trim()) || (settings.continueText && String(settings.continueText).trim()) || 'continue';
				console.log(LOG_PREFIX, '[test-send] 开始, text:', text);
				if (!await setInputText(text)) {
					respond({ status: 'error', message: '未找到输入框' });
					break;
				}
				console.log(LOG_PREFIX, '[test-send] setInputText 成功, 内容:', (findInputEl()?.textContent || '').substring(0, 50));
				markActionClick();
				await new Promise(r => setTimeout(r, 200));
				const method = trySendMessage();
				console.log(LOG_PREFIX, '[test-send] 发送方式:', method);
				if (method) {
					respond({ status: 'done', message: '已发送(' + method + '): ' + text });
				} else {
					// 发送失败，清空输入框防止残留
					try {
						const el = findInputEl();
						if (el) { el.focus(); document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); }
					} catch {}
					respond({ status: 'error', message: '所有发送方式均失败' });
				}
				break;
			}
			case 'test-switch-account': {
				respond({ status: 'running', message: '正在发送切号信号（强制测试模式）...' });
				sendPoolSignal('quota-exhausted', lastUserMessage, { force: true });
				respond({ status: 'done', message: '切号信号已发送（等待 pool 响应）' });
				break;
			}
			case 'test-permission': {
				// 测试按钮强制绕过总开关
				checkForPermissionApproval({ force: true });
				respond({ status: 'done', message: '权限检测已执行（强制测试模式）' });
				break;
			}
			case 'get-current-model': {
				const current = getCurrentModelName();
				respond({ status: 'done', currentModel: current || '未知' });
				break;
			}
			default:
				respond({ status: 'error', message: '未知命令: ' + cmd.action });
		}
	}

	// ========== 初始化 ==========
	function init() {
		console.log('🚀 Windsurf Better v' + VERSION + ' 初始化');
		// Settings UI moved to sidebar panel; only inject styles for bubbles
		injectBubblesStyles();
		dismissCorruptWarning();
		startBridgePolling();
		if (settings.continueMode === 'smart') startAutoContinue();
		if (settings.autoRecoveryEnabled) startAutoRecovery();
		console.log(LOG_PREFIX + '[Notify] init: notifyEnabled=' + settings.notifyEnabled + ', sound=' + settings.notifySound + ', desktop=' + settings.notifyDesktop + ', trigger=' + settings.notifyTrigger + ', tone=' + settings.notifyTone);
		if (settings.notifyEnabled) startNotifyObserver();
		else console.log(LOG_PREFIX + '[Notify] ⚠️ notifyEnabled=false，未启动观察器');
		// brainless 模式不在 init 自动启动——必须由用户显式点击「开始运行」触发
		// 重启后 continueMode 应为 'smart'，不会走到 brainless 分支
		if (settings.continueMode === 'brainless') {
			console.log(LOG_PREFIX + '[Brainless] 检测到残留 brainless 状态，重置为 smart（需手动启动长任务）');
			settings.continueMode = 'smart';
			saveSettings(settings);
			startAutoContinue();
		}
		
		// 启动回复建议提示
		if (settings.bubblesEnabled) {
			const tryStartBubbles = () => {
				const root = findChatRoot();
				if (root) {
					logBubbles('✅聊天面板已就绪');
					startBubblesObserving();
				} else {
					const obs = new MutationObserver((_, o) => {
						const r = findChatRoot();
						if (r) {
							o.disconnect();
							logBubbles('✅聊天面板已就绪(延迟)');
							startBubblesObserving();
						}
					});
					obs.observe(document.body, { childList: true, subtree: true });
					logBubbles('⏳等待聊天面板...');
				}
			};
			if (document.readyState === 'complete') setTimeout(tryStartBubbles, 1000);
			else window.addEventListener('load', () => setTimeout(tryStartBubbles, 1000));
		}
		
		// 启动汉化功能
		if (settings.localizationEnabled) {
			startLocalizationObserver();
			enqueue(document.body);
			logLocalization('✅汉化已启用');
		}

		// 统一 storage 事件监听（合并命令分发 + 设置同步，减少调度开销）
		window.addEventListener('storage', (e) => {
			// 1) 来自侧栏的命令
			if (e.key === 'ws-better-command') {
				try {
					const cmd = JSON.parse(e.newValue);
					if (!cmd || !cmd.action) return;
					console.log(LOG_PREFIX + '[Command] 收到命令: ' + cmd.action);
					handleSidebarCommand(cmd);
				} catch {}
				return;
			}
			// 2) 设置面板同步（storage event 路径，跨 origin 不可达；保留作为同源 fallback）
			if (e.key !== STORAGE_KEY) return;
			const newSettings = loadSettings();
			applySettingsChange(newSettings, '[storage event]');
		});
	}

	/**
	 * 实时应用设置变更：合并新设置 + 启停各模块的 observer
	 * 调用源：
	 *   1) storage event（同源 fallback）
	 *   2) bridge 'apply-settings' 命令（侧栏 webview 改设置 → 跨 origin 推送）
	 */
	function applySettingsChange(newSettings, source) {
		if (!newSettings || typeof newSettings !== 'object') return;
		const old = { ...settings };
		Object.assign(settings, newSettings);
		// 持久化到本地 localStorage（保证下次加载快速读到）
		try { saveSettings(settings); } catch {}

		// 响应回复建议开关变化
		if (old.bubblesEnabled !== settings.bubblesEnabled) {
			if (settings.bubblesEnabled) startBubblesObserving();
			else if (bubblesObserver) { bubblesObserver.disconnect(); bubblesObserver = null; }
		}
		// 响应回复建议主题/形状变化：对所有现存 bubbles 重应用 inline style（CSS 是静态的，无需重注入）
		if (old.bubblesTheme !== settings.bubblesTheme || old.bubblesShape !== settings.bubblesShape) {
			try { restyleAllBubbles(); } catch (err) { console.warn(LOG_PREFIX + '[Bubbles] restyle 失败:', err); }
		}
		// 响应汉化开关变化（实时还原 / 重新翻译）
		if (old.localizationEnabled !== settings.localizationEnabled) {
			if (settings.localizationEnabled) {
				startLocalizationObserver();
				enqueue(document.body);
			} else {
				if (localizationObserver) { localizationObserver.disconnect(); localizationObserver = null; }
				try { revertLocalization(); } catch (err) { console.warn(LOG_PREFIX + '[Localization] 还原失败:', err); }
			}
		}
		// 响应自动继续模式变化
		const oldGd = old.guardian || {};
		const newGd = settings.guardian || {};
		if (old.continueMode !== settings.continueMode || oldGd.autoContinueButton !== newGd.autoContinueButton) {
			// 停止旧模式
			if (autoContinueObserver) { autoContinueObserver.disconnect(); autoContinueObserver = null; }
			if (brainlessTimer) { clearInterval(brainlessTimer); brainlessTimer = null; }
			// 启动新模式
			if (settings.continueMode === 'smart') startAutoContinue();
			else if (settings.continueMode === 'brainless') startBrainlessMode();
		}
		// 响应关闭损坏通知开关变化
		if (old.dismissCorruptEnabled !== settings.dismissCorruptEnabled) {
			if (settings.dismissCorruptEnabled) dismissCorruptWarning();
			else if (dismissCorruptObserver) { dismissCorruptObserver.disconnect(); dismissCorruptObserver = null; }
		}
		// 响应自动恢复开关变化
		if (old.autoRecoveryEnabled !== settings.autoRecoveryEnabled) {
			if (settings.autoRecoveryEnabled) startAutoRecovery();
			else {
				if (recoveryObserver) { recoveryObserver.disconnect(); recoveryObserver = null; }
				if (recoveryPollTimer) { clearInterval(recoveryPollTimer); recoveryPollTimer = null; }
			}
		}
		// 响应完成提醒开关变化
		if (old.notifyEnabled !== settings.notifyEnabled) {
			if (settings.notifyEnabled) startNotifyObserver();
			else if (notifyObserver) { notifyObserver.disconnect(); notifyObserver = null; }
		}
		// 响应无脑模式参数变化（模式切换已在上方处理）
		const oldLt = old.longTask || {};
		const newLt = settings.longTask || {};
		if (settings.continueMode === 'brainless' && (old.brainlessIdleSeconds !== settings.brainlessIdleSeconds || oldLt.idleSeconds !== newLt.idleSeconds)) {
			startBrainlessMode();
		}
		// recoveryRules / customRecoveryRules / 其他纯数据字段：直接 Object.assign 后即生效，无需启停
		console.log(LOG_PREFIX + ' 设置已实时应用 ' + (source || ''));
	}
	
	// 诊断工具：扫描当前 DOM，看哪些元素被识别为错误、哪些被过滤
	window.wsDiagnoseError = function() {
		const result = getLatestErrorText();
		console.group('%c[wsDiagnose] getLatestErrorText 结果', 'color:#10b981;font-weight:bold');
		console.log('text:', result.text);
		console.log('el:', result.el);
		if (result.el) {
			console.log('el.dataset._wsRecoveryHandled:', result.el.dataset._wsRecoveryHandled);
			console.log('closest assistant:', result.el.closest(ASSISTANT_MSG_SEL));
		}
		console.groupEnd();

		// 找出所有可能含错误的元素（不论是否被过滤）
		console.group('%c[wsDiagnose] 全局扫描含「速率限制/rate limit/权限拒绝/quota」的元素', 'color:#f59e0b;font-weight:bold');
		const allEls = document.body.querySelectorAll('span, p, div, [role="alert"], [role="status"]');
		const RE = /权限拒绝|速率限制|rate limit|quota|额度|配额|all API providers/i;
		let count = 0;
		for (const el of allEls) {
			const txt = (el.textContent || '').trim();
			if (txt.length < 10 || txt.length > 500) continue;
			if (el.children.length > 5) continue;
			if (!RE.test(txt)) continue;
			if (el.closest('#ws-recovery-toast,[id^="ws-"]')) continue;
			count++;
			if (count > 10) break;
			const orig = el.getAttribute('data-ws-orig');
			const descOrig = [];
			el.querySelectorAll('[data-ws-orig]').forEach(n => descOrig.push(n.getAttribute('data-ws-orig')));
			let ancestorOrig = null;
			let p = el.parentElement;
			for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
				if (p.hasAttribute && p.hasAttribute('data-ws-orig')) {
					ancestorOrig = { level: i + 1, text: p.getAttribute('data-ws-orig').substring(0, 100) };
					break;
				}
			}
			console.log({
				idx: count,
				text: txt.substring(0, 150),
				inAssistant: !!el.closest(ASSISTANT_MSG_SEL),
				inUser: !!el.closest(USER_MSG_SEL),
				selfOrig: orig ? orig.substring(0, 100) : null,
				descOrigCount: descOrig.length,
				descOrigSample: descOrig[0] ? descOrig[0].substring(0, 100) : null,
				ancestorOrig: ancestorOrig,
				el: el
			});
		}
		console.log('共找到', count, '个候选');
		console.groupEnd();
	};
	console.log(LOG_PREFIX + '[Diag] 已暴露诊断函数: window.wsDiagnoseError()');

	// 暴露测试函数到全局，方便调试
	window.wsTestRecoveryBanner = function() {
		console.log(LOG_PREFIX + '[Test] 手动触发恢复 banner 测试');
		showRecoveryPrompt({
			title: '测试：网络错误',
			category: 'networkErrors',
			defaultAction: 'retry',
			errorText: 'Model provider unreachable (测试)',
			countdownMs: 5000,
			onExecute: (chosenAction) => {
				console.log(LOG_PREFIX + '[Test] 用户选择了: ' + chosenAction);
				showRecoveryNotification('测试完成：选择了 ' + chosenAction);
			},
			onCancel: () => {
				console.log(LOG_PREFIX + '[Test] 用户取消了');
				showRecoveryNotification('测试完成：用户取消了');
			}
		});
	};
	console.log(LOG_PREFIX + '[Test] 已暴露测试函数: window.wsTestRecoveryBanner()');

	if (document.readyState === 'loading') {
		window.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
	} else {
		setTimeout(init, 800);
	}
})();
