/**
 * Windsurf Better v1.0.0
 * 整合版：回复建议提示 + 汉化
 */
(function () {
	'use strict';
	const VERSION = '1.0.2';
	const LOG_PREFIX = '[WS-Better]';
	
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
		autoContinueEnabled: true,
		dismissCorruptEnabled: true,
		autoSwitchOnQuota: true,
		autoSwitchOnRateLimit: true,
		// 自动恢复
		autoRecoveryEnabled: true,
		autoApproveWebRequests: false,
		autoSendContinue: true,
		continueAfterSwitch: true,  // 切号后自动发送"继续"而非重发原消息
		recoveryMaxRetries: 3,
		recoveryBaseDelay: 5000,
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
		try {
			const r = localStorage.getItem(STORAGE_KEY);
			return r ? { ...DEFAULT_SETTINGS, ...JSON.parse(r) } : { ...DEFAULT_SETTINGS };
		} catch {
			return { ...DEFAULT_SETTINGS };
		}
	}
	
	function saveSettings(s) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
		} catch {}
	}
	
	let settings = loadSettings();
	
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
		{ id:'emerald',name:'翡翠',bg:'linear-gradient(135deg,#22c55e,#06b6d4,#3b82f6)',bgHover:'linear-gradient(135deg,#16a34a,#0891b2,#2563eb)',color:'#fff',shadow:'0 2px 8px rgba(34,197,94,.2)',border:'none',letterBg:'rgba(255,255,255,.2)',letterColor:'#fff',tagBg:'linear-gradient(135deg,#22c55e,#06b6d4,#3b82f6)'},
		{ id:'aurora',name:'极光',bg:'linear-gradient(135deg,#a855f7,#ec4899)',bgHover:'linear-gradient(135deg,#9333ea,#db2777)',color:'#fff',shadow:'0 2px 8px rgba(168,85,247,.2)',border:'none',letterBg:'rgba(255,255,255,.2)',letterColor:'#fff',tagBg:'linear-gradient(135deg,#a855f7,#ec4899)'},
		{ id:'sunset',name:'日落',bg:'linear-gradient(135deg,#f59e0b,#ef4444)',bgHover:'linear-gradient(135deg,#d97706,#dc2626)',color:'#fff',shadow:'0 2px 8px rgba(245,158,11,.2)',border:'none',letterBg:'rgba(255,255,255,.2)',letterColor:'#fff',tagBg:'linear-gradient(135deg,#f59e0b,#ef4444)'},
		{ id:'ocean',name:'海洋',bg:'#1e40af',bgHover:'#1e3a8a',color:'#fff',shadow:'0 2px 8px rgba(30,64,175,.25)',border:'none',letterBg:'rgba(255,255,255,.15)',letterColor:'#fff',tagBg:'#1e40af'},
		{ id:'glass',name:'毛玻璃',bg:'rgba(255,255,255,.08)',bgHover:'rgba(255,255,255,.14)',color:'rgba(255,255,255,.8)',shadow:'0 2px 8px rgba(0,0,0,.1)',border:'1px solid rgba(255,255,255,.12)',letterBg:'rgba(255,255,255,.1)',letterColor:'rgba(255,255,255,.6)',tagBg:'rgba(167,139,250,.3)',blur:true},
		{ id:'dark',name:'暗夜',bg:'#1f2937',bgHover:'#111827',color:'#e5e7eb',shadow:'0 2px 8px rgba(0,0,0,.3)',border:'1px solid rgba(255,255,255,.08)',letterBg:'rgba(255,255,255,.1)',letterColor:'#9ca3af',tagBg:'#374151'},
	];
	const BUBBLE_SHAPES = [{id:'pill',radius:'20px'},{id:'rounded',radius:'10px'},{id:'soft',radius:'6px'},{id:'sharp',radius:'2px'}];
	const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const ICON_BUBBLES = 'M20,2H4C2.9,2,2,2.9,2,4v18l4-4h14c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2z M6,14v-2h8v2H6z M14,11H6V9h8V11z M18,8H6V6h12V8z';
	
	function injectBubblesStyles() {
		if (document.getElementById('ws-bubbles-css')) return;
		const style = document.createElement('style');
		style.id = 'ws-bubbles-css';
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
		document.head.appendChild(style);
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
	
	function setInputText(text) {
		const inputEl = findInputEl();
		if (!inputEl) { logBubbles('找不到输入框'); return false; }
		inputEl.focus();
		if (inputEl.getAttribute('data-lexical-editor') === 'true') {
			const sel = window.getSelection();
			if (sel && inputEl.firstChild) { sel.selectAllChildren(inputEl); sel.deleteFromDocument(); }
			document.execCommand('insertText', false, text);
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));
			logBubbles('已写入(Lexical)');
			return true;
		}
		if (inputEl.contentEditable === 'true') {
			inputEl.textContent = '';
			document.execCommand('insertText', false, text);
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));
			logBubbles('已写入(contenteditable)');
			return true;
		}
		if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
			const ns = Object.getOwnPropertyDescriptor(inputEl.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
			if (ns) ns.call(inputEl, text); else inputEl.value = text;
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));
			inputEl.dispatchEvent(new Event('change', { bubbles: true }));
			logBubbles('已写入(textarea)');
			return true;
		}
		inputEl.innerHTML = '';
		text.split('\n').forEach(line => {
			const p = document.createElement('p');
			p.textContent = line || '\u200B';
			inputEl.appendChild(p);
		});
		inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		logBubbles('已写入(fallback)');
		return true;
	}
	
	function findSendBtnAdvanced() {
		const root = findChatRoot();
		const scope = root || document;
		for (const sel of SEND_BTN_CANDIDATES) {
			const el = scope.querySelector(sel);
			if (el) return el;
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
		setInputText(text);
		if (!settings.bubblesAutoSend) return;
		setTimeout(() => {
			const inputEl = findInputEl();
			if (!inputEl) return;
			inputEl.focus();
			try { inputEl.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true, composed: true })); } catch {}
			const targets = new Set([inputEl, inputEl.parentElement, inputEl.closest('[role="textbox"]'), document.activeElement].filter(Boolean));
			for (const t of targets) { t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true })); }
			setTimeout(() => {
				const btn = findSendBtnAdvanced();
				if (btn && !btn.disabled) { btn.click(); return; }
				const scope = findChatRoot() || document;
				for (const b of scope.querySelectorAll('button')) {
					const r = b.getBoundingClientRect();
					if (r.width > 0 && r.height > 0 && !b.disabled && r.bottom > window.innerHeight * 0.7) { b.click(); return; }
				}
			}, 200);
		}, 200);
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
		
		const themeId = settings.bubblesTheme || 'emerald';
		const theme = BUBBLE_THEMES.find(t => t.id === themeId);
		if (theme && themeId !== 'emerald') {
			const S = (el, p, v) => el.style.setProperty(p, v, 'important');
			wrapper.querySelectorAll('.ws-bubble-option,.ws-bubble-chip,.ws-bubble-related').forEach(btn => {
				S(btn, 'background', theme.bg);
				S(btn, 'color', theme.color);
				S(btn, 'box-shadow', theme.shadow);
				if (theme.border && theme.border !== 'none') S(btn, 'border', theme.border); else S(btn, 'border', 'none');
				if (theme.blur) btn.style.backdropFilter = 'blur(12px)';
				btn.addEventListener('mouseenter', () => S(btn, 'background', theme.bgHover));
				btn.addEventListener('mouseleave', () => S(btn, 'background', theme.bg));
			});
			wrapper.querySelectorAll('.ws-bubble-option-letter').forEach(el => {
				S(el, 'background', theme.letterBg);
				S(el, 'color', theme.letterColor);
			});
			wrapper.querySelectorAll('.ws-bubble-option-text').forEach(el => S(el, 'color', theme.color));
			wrapper.querySelectorAll('.ws-bubbles-mode-tag').forEach(el => S(el, 'background', theme.tagBg || theme.bg));
		}
		
		const shapeId = settings.bubblesShape || 'rounded';
		const shape = BUBBLE_SHAPES.find(s => s.id === shapeId);
		if (shape) {
			wrapper.querySelectorAll('.ws-bubble-option,.ws-bubble-chip,.ws-bubble-related').forEach(btn => btn.style.setProperty('border-radius', shape.radius, 'important'));
			wrapper.querySelectorAll('.ws-bubble-option-letter').forEach(el => {
				const lr = Math.max(2, parseInt(shape.radius) - 2) + 'px';
				el.style.setProperty('border-radius', lr, 'important');
			});
		}
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
			const txt = range.toString();
			const metaRe = /^\s*(type|title|question|mode|items)\s*:/i;
			let inItems = false;
			txt.split(/\r?\n/).forEach(line => {
				if (/^\s*items\s*:/i.test(line)) { inItems = true; return; }
				if (!inItems) return;
				let t = line.trim();
				t = t.replace(/^[-*•·]\s*/, '');
				t = t.replace(/\s*:{3}\s*$/, '');
				t = t.replace(/^:{3}bubbles\s*/i, '');
				if (t && !metaRe.test(t)) items.push(t);
			});
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
	const EXCLUDE_SELECTOR = '.monaco-editor, pre, code, textarea, input, [contenteditable="true"], .xterm, .terminal, .debug-console, .ws-bubbles, .ws-better-panel';
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
		['Low', '低'],
		['Conservative suggestions with higher confidence', '保守的建议，置信度更高'],
		['Medium', '中等'],
		['Balanced suggestions', '平衡的建议'],
		['High', '高'],
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
		['tasks done', '任务完成'],
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
		['Show Allow/Deny list', '显示 允许/拒绝 列表'],
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
		['Recently Used', '最近使用'],
		['Recommended', '推荐'],
		['New', '新'],
		// 'context' 不做静态翻译，避免误翻文件夹名；"NK context" 和 "context used" 已由正则/长短语覆盖
		['Thinking', '思考'],
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
		['Plan ends in', '套餐将在'],
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
		['Ask anything', '询问任何问题'],

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
		['Search settings', '搜索设置'],
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
		['Fast', '快速'],
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
		['Surfing.', '冲浪中…'],

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
		[/^Quota resets daily\/weekly\.\s*Plan ends in (\d+) days$/i, '配额每日/每周重置。套餐将在 $1 天后到期'],
		[/^Quota resets daily\/weekly$/i, '配额每日/每周重置'],
		[/^Plan ends in (\d+) days\s*\((.+)\)$/i, '套餐将在 $1 天后到期 ($2)'],
		[/^These settings only apply to Devin for Terminal and are saved to\s*(.+)$/i, '这些设置仅适用于 Devin 终端，并保存到 $1'],
		[/^Resets\s+(.+)$/i, '重置于 $1'],
		[/^(\d+)K context$/i, '$1K 上下文'],
		[/^\$([0-9.]+)\s*\/\s*1M tokens$/i, '$$$1 / 百万 tokens'],
		[/^Plan ends in (\d+) days$/i, '套餐将在 $1 天后到期'],
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
		[/^(\d+)%\s*\(([^)]+)\)\s*context used$/i, '$1% ($2) 上下文已用'],
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
	];
	
	function logLocalization(...args) { console.log(LOG_PREFIX + '[Localization]', ...args); }
	
	function translateText(text) {
		if (!text || !text.trim()) return text;
		const leading = text.match(/^\s*/)?.[0] ?? '';
		const trailing = text.match(/\s*$/)?.[0] ?? '';
		const core = text.trim();
		
		if (TRANSLATIONS.has(core)) {
			return `${leading}${TRANSLATIONS.get(core)}${trailing}`;
		}
		
		for (const [pattern, replacement] of REGEX_TRANSLATIONS) {
			if (pattern.test(core)) {
				return `${leading}${core.replace(pattern, replacement)}${trailing}`;
			}
		}
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
			const translated = translateText(value);
			if (translated !== value) {
				el.setAttribute(attr, translated);
			}
		}
	}
	
	function translateTextNode(node) {
		if (!node || shouldSkip(node)) return;
		const original = node.nodeValue;
		const translated = translateText(original);
		if (translated !== original) {
			node.nodeValue = translated;
		}
	}
	
	function scanAndTranslate(root) {
		if (!root || !settings.localizationEnabled) return;
		if (root.nodeType === Node.TEXT_NODE) {
			translateTextNode(root);
			return;
		}
		
		const elementRoot = root.nodeType === Node.ELEMENT_NODE ? root : document.body;
		if (!elementRoot) return;
		
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
	}
	
	let pendingRoots = new Set();
	let rafId = 0;
	let localizationObserver = null;
	
	function flushQueue() {
		rafId = 0;
		if (!settings.localizationEnabled) return;
		for (const root of pendingRoots) {
			scanAndTranslate(root);
		}
		pendingRoots.clear();
	}
	
	function enqueue(root) {
		pendingRoots.add(root || document.body);
		if (!rafId) {
			rafId = requestAnimationFrame(flushQueue);
		}
	}
	
	function startLocalizationObserver() {
		if (localizationObserver) localizationObserver.disconnect();
		localizationObserver = new MutationObserver((mutations) => {
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
	
	// ========== 统一设置面板 ==========
	function injectPanelStyles() {
		if (document.getElementById('ws-better-panel-css')) return;
		const style = document.createElement('style');
		style.id = 'ws-better-panel-css';
		style.textContent = `
.ws-better-toggle{position:fixed;top:30%;right:20px;width:32px;height:32px;border-radius:50%;background:rgba(128,128,128,.15);color:rgba(150,150,150,.6);border:1px solid rgba(128,128,128,.2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 4px rgba(0,0,0,.3);z-index:9999;transition:all .2s}
.ws-better-toggle:hover{background:rgba(128,128,128,.25);color:rgba(180,180,180,.9);transform:scale(1.05);box-shadow:0 2px 8px rgba(0,0,0,.4)}
.ws-better-panel{position:fixed;top:calc(30% + 40px);right:20px;width:300px;background:#1e1e2e;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:16px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,.4);color:#e5e7eb;font-size:13px;display:none;overflow:visible}
.ws-better-panel.open{display:block}
.ws-better-panel h3{margin:0 0 12px;font-size:14px;color:#0ea5e9;display:flex;align-items:center;justify-content:space-between}
.ws-better-close{background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;padding:0 2px;line-height:1}
.ws-better-close:hover{color:#e5e7eb}
.ws-better-section{margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.08)}
.ws-better-section:last-child{margin-bottom:0;padding-bottom:0;border-bottom:none}
.ws-better-section-title{font-size:12px;font-weight:600;color:#9ca3af;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px}
.ws-better-panel label{display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer}
.ws-dd{position:relative;width:100%;margin-bottom:8px;box-sizing:border-box}
.ws-dd-btn{width:100%;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:#2a2a3e;color:#e5e7eb;font-size:13px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;text-align:left;box-sizing:border-box}
.ws-dd-btn:hover{border-color:rgba(255,255,255,.35)}
.ws-dd-btn::after{content:'\\u25BE';font-size:10px;color:#9ca3af}
.ws-dd-list{display:none;position:absolute;top:100%;left:0;width:100%;box-sizing:border-box;background:#2a2a3e;border:1px solid rgba(255,255,255,.15);border-radius:6px;margin-top:4px;max-height:200px;overflow-y:auto;z-index:10001;box-shadow:0 4px 16px rgba(0,0,0,.4);scrollbar-width:thin;scrollbar-color:#555 transparent}
.ws-dd-list::-webkit-scrollbar{width:6px}
.ws-dd-list::-webkit-scrollbar-track{background:transparent;border-radius:3px}
.ws-dd-list::-webkit-scrollbar-thumb{background:#555;border-radius:3px}
.ws-dd-list::-webkit-scrollbar-thumb:hover{background:#777}
.ws-dd.open .ws-dd-list{display:block}
.ws-dd-item{padding:6px 10px;color:#e5e7eb;cursor:pointer;font-size:13px}
.ws-dd-item:hover{background:rgba(255,255,255,.1)}
.ws-dd-item.active{background:rgba(14,165,233,.25);color:#0ea5e9}
.monaco-list-row .label-name,.tab .label-name,.action-label,.monaco-button,.pane-header h3,.title-label span,.composite.title .title-label a,.tabs-container .tab .tab-label a{white-space:nowrap!important}
`;
		document.head.appendChild(style);
	}
	
	function createSettingsUI() {
		if (document.getElementById('ws-better-toggle')) return;
		
		injectPanelStyles();
		injectBubblesStyles();
		
		const toggle = document.createElement('button');
		toggle.id = 'ws-better-toggle';
		toggle.className = 'ws-better-toggle';
		toggle.textContent = '⚙️';
		toggle.title = 'Windsurf Better Settings';
		
		const panel = document.createElement('div');
		panel.className = 'ws-better-panel';
		panel.id = 'ws-better-panel';
		
		const title = document.createElement('h3');
		const titleTxt = document.createElement('span');
		titleTxt.textContent = '⚙️ Windsurf Better v' + VERSION;
		title.appendChild(titleTxt);
		const closeBtn = document.createElement('button');
		closeBtn.className = 'ws-better-close';
		closeBtn.textContent = '×';
		closeBtn.addEventListener('click', () => panel.classList.remove('open'));
		title.appendChild(closeBtn);
		panel.appendChild(title);
		
		// 回复建议提示设置区块
		const bubblesSection = document.createElement('div');
		bubblesSection.className = 'ws-better-section';
		const bubblesTitle = document.createElement('div');
		bubblesTitle.className = 'ws-better-section-title';
		bubblesTitle.textContent = '回复建议提示';
		bubblesSection.appendChild(bubblesTitle);
		
		const bubblesEnable = document.createElement('label');
		const bubblesCheck = document.createElement('input');
		bubblesCheck.type = 'checkbox';
		bubblesCheck.checked = settings.bubblesEnabled;
		bubblesCheck.addEventListener('change', () => {
			settings.bubblesEnabled = bubblesCheck.checked;
			saveSettings(settings);
			if (settings.bubblesEnabled) startBubblesObserving();
			else if (bubblesObserver) { bubblesObserver.disconnect(); bubblesObserver = null; }
		});
		bubblesEnable.appendChild(bubblesCheck);
		bubblesEnable.appendChild(document.createTextNode(' 启用回复建议'));
		bubblesSection.appendChild(bubblesEnable);
		
		const bubblesAutoSend = document.createElement('label');
		const bubblesAutoCheck = document.createElement('input');
		bubblesAutoCheck.type = 'checkbox';
		bubblesAutoCheck.checked = settings.bubblesAutoSend;
		bubblesAutoCheck.addEventListener('change', () => {
			settings.bubblesAutoSend = bubblesAutoCheck.checked;
			saveSettings(settings);
		});
		bubblesAutoSend.appendChild(bubblesAutoCheck);
		bubblesAutoSend.appendChild(document.createTextNode(' 点击自动发送'));
		bubblesSection.appendChild(bubblesAutoSend);
		
		function mkDropdown(label, items, current, onChange) {
			const wrap = document.createElement('div');
			wrap.style.marginTop = '8px';
			const lbl = document.createElement('div');
			lbl.textContent = label;
			wrap.appendChild(lbl);
			const dd = document.createElement('div');
			dd.className = 'ws-dd';
			const btn = document.createElement('div');
			btn.className = 'ws-dd-btn';
			btn.textContent = (items.find(i => i.value === current) || items[0]).label;
			const list = document.createElement('div');
			list.className = 'ws-dd-list';
			items.forEach(item => {
				const d = document.createElement('div');
				d.className = 'ws-dd-item' + (item.value === current ? ' active' : '');
				d.textContent = item.label;
				d.dataset.val = item.value;
				d.addEventListener('click', e => {
					e.stopPropagation();
					btn.textContent = item.label;
					list.querySelectorAll('.ws-dd-item').forEach(x => x.classList.remove('active'));
					d.classList.add('active');
					dd.classList.remove('open');
					onChange(item.value);
				});
				list.appendChild(d);
			});
			btn.addEventListener('click', e => { e.stopPropagation(); dd.classList.toggle('open'); });
			document.addEventListener('click', () => dd.classList.remove('open'));
			dd.appendChild(btn);
			dd.appendChild(list);
			wrap.appendChild(dd);
			return wrap;
		}
		
		const themeDd = mkDropdown('主题:', BUBBLE_THEMES.map(t => ({ value: t.id, label: t.name })), settings.bubblesTheme, v => {
			settings.bubblesTheme = v;
			saveSettings(settings);
		});
		bubblesSection.appendChild(themeDd);
		
		const shapeNames = { pill: '胶囊', rounded: '圆角', soft: '柔和', sharp: '直角' };
		const shapeDd = mkDropdown('形状:', BUBBLE_SHAPES.map(s => ({ value: s.id, label: shapeNames[s.id] || s.id })), settings.bubblesShape, v => {
			settings.bubblesShape = v;
			saveSettings(settings);
		});
		bubblesSection.appendChild(shapeDd);
		
		panel.appendChild(bubblesSection);
		
		// 汉化设置区块
		const locSection = document.createElement('div');
		locSection.className = 'ws-better-section';
		const locTitle = document.createElement('div');
		locTitle.className = 'ws-better-section-title';
		locTitle.textContent = '界面汉化';
		locSection.appendChild(locTitle);
		
		const locEnable = document.createElement('label');
		const locCheck = document.createElement('input');
		locCheck.type = 'checkbox';
		locCheck.checked = settings.localizationEnabled;
		locCheck.addEventListener('change', () => {
			settings.localizationEnabled = locCheck.checked;
			saveSettings(settings);
			if (settings.localizationEnabled) {
				startLocalizationObserver();
				enqueue(document.body);
			} else if (localizationObserver) {
				localizationObserver.disconnect();
				localizationObserver = null;
			}
		});
		locEnable.appendChild(locCheck);
		locEnable.appendChild(document.createTextNode(' 启用汉化'));
		locSection.appendChild(locEnable);
		
		panel.appendChild(locSection);
		
		// 自动继续区块
		const acSection = document.createElement('div');
		acSection.className = 'ws-better-section';
		const acTitle = document.createElement('div');
		acTitle.className = 'ws-better-section-title';
		acTitle.textContent = '自动操作';
		acSection.appendChild(acTitle);
		
		const acEnable = document.createElement('label');
		const acCheck = document.createElement('input');
		acCheck.type = 'checkbox';
		acCheck.checked = settings.autoContinueEnabled;
		acCheck.addEventListener('change', () => {
			settings.autoContinueEnabled = acCheck.checked;
			saveSettings(settings);
			if (settings.autoContinueEnabled) startAutoContinue();
			else if (autoContinueObserver) { autoContinueObserver.disconnect(); autoContinueObserver = null; }
		});
		acEnable.appendChild(acCheck);
		acEnable.appendChild(document.createTextNode(' 回复截断时自动继续'));
		acSection.appendChild(acEnable);
		
		panel.appendChild(acSection);
		
		toggle.addEventListener('click', () => panel.classList.toggle('open'));
		document.body.appendChild(toggle);
		document.body.appendChild(panel);
	}
	
	// ========== 自动继续 ==========
	let autoContinueObserver = null;
	function startAutoContinue() {
		if (autoContinueObserver) { autoContinueObserver.disconnect(); autoContinueObserver = null; }
		if (!settings.autoContinueEnabled) return;
		const tryClick = () => {
			if (!settings.autoContinueEnabled) return;
			const btns = document.querySelectorAll('button, [role="button"]');
			for (const btn of btns) {
				const txt = (btn.textContent || '').trim();
				if (txt === 'Continue response' || txt === '继续回复') {
					console.log(LOG_PREFIX + '[AutoContinue] 检测到截断，自动继续...');
					setTimeout(() => btn.click(), 800);
					return;
				}
			}
		};
		autoContinueObserver = new MutationObserver(() => {
			if (settings.autoContinueEnabled) tryClick();
		});
		autoContinueObserver.observe(document.body, { childList: true, subtree: true });
		console.log(LOG_PREFIX + '[AutoContinue] ✅已启用');
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
					if (c) { c.click(); logLocalization('✅关闭损坏通知'); }
					else { t.style.display = 'none'; logLocalization('✅隐藏损坏通知'); }
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
	// A 类：可自动重试的错误
	const RETRYABLE_ERRORS = [
		/Model provider unreachable/i,
		/an internal error occurred/i,
		/retryable error from model provider/i,
		/API provider is overloaded\.\s*Please try again/i,
		/This is taking a long time/i,
		// 社区高频：deadline exceeded（thinking 超时被中断）
		/Deadline exceeded:.*context deadline exceeded/i,
		/context deadline exceeded/i,
		/Client\.Timeout or context cancellation/i,
		// 社区高频：Cascade 内部错误（Claude Sonnet 4 等）
		/Cascade has encountered an internal error in this step/i,
		/No credits consumed on this tool call/i,
		// 社区高频：通用未预期错误
		/Encountered unexpected error during/i,
		// 社区高频：请求耗时过长
		/This request is taking longer than expected/i,
		// 模型 / 上下文流式中断
		/stream.*was\s*(interrupted|cancelled|aborted)/i,
		/connection.*was\s*(reset|closed)/i,
	];

	// B 类：需要切号的错误
	const SWITCHABLE_ERRORS = [
		{ pattern: /daily usage quota has been exhausted/i, signal: 'quota-daily-exhausted' },
		{ pattern: /usage quota is exhausted/i, signal: 'quota-exhausted' },
		{ pattern: /resource_exhausted/i, signal: 'rate-limited' },
		{ pattern: /all API providers are over capacity/i, signal: 'provider-overloaded' },
		{ pattern: /Failed precondition.*quota/i, signal: 'quota-exhausted' },
		{ pattern: /all API providers are over their global rate limit/i, signal: 'rate-limited' },
		{ pattern: /rate limit exceeded/i, signal: 'rate-limited' },
		{ pattern: /upgrade to a Pro account for higher limits/i, signal: 'rate-limited' },
		{ pattern: /权限拒绝.*rate limit/i, signal: 'rate-limited' },
		// 第三方提供商临时故障：需要切号重试
		{ pattern: /third-party model provider is experiencing issues/i, signal: 'provider-unavailable' },
		{ pattern: /model provider is currently not available/i, signal: 'provider-unavailable' },
	];

	// C 类：自动继续触发
	const CONTINUE_TRIGGERS = [
		{ text: 'Continue response', action: 'click' },
		{ text: '继续回复', action: 'click' },
		{ pattern: /reached.*invocation limit/i, action: 'send-continue' },
		// 官方文档：每个 prompt 最多 20 次工具调用
		{ pattern: /Cascade can make up to \d+ tool calls per prompt/i, action: 'send-continue' },
		{ pattern: /maximum (?:number of )?tool calls reached/i, action: 'send-continue' },
		{ pattern: /tool call limit reached/i, action: 'send-continue' },
	];

	// D 类：仅通知（无法自动恢复，需要用户介入）
	const NOTIFY_ONLY = [
		{ pattern: /Windsurf version is out of date/i, hint: '请更新 Windsurf 版本' },
		// 登录态失效：换号无用，需要重新登录
		{ pattern: /Failed to log in:\s*\[deadline_exceeded\]/i, hint: '登录态失效，请重新登录或重启 Windsurf' },
		{ pattern: /Authentication (?:failed|expired)/i, hint: '认证失败，请重新登录' },
		{ pattern: /unauthorized/i, hint: '未授权，请重新登录' },
		// 上下文太长：切号无用，需要压缩对话
		{ pattern: /context length exceeded/i, hint: '上下文超长，请压缩对话或新开会话' },
		{ pattern: /prompt is too long/i, hint: '提示词过长，请精简后重试' },
		{ pattern: /maximum context length/i, hint: '已达模型最大上下文，请新开会话' },
	];

	let recoveryObserver = null;
	let recoveryRetryCount = 0;
	let lastUserMessage = '';
	let lastRecoveryTs = 0;
	let lastPoolResultTs = 0;
	let _lastErrorFingerprint = '';

	// 生成错误指纹（去除时间戳/数字，仅保留语义）
	function makeErrorFingerprint(text) {
		return (text || '')
			.toLowerCase()
			.replace(/\d+/g, '#')
			.replace(/\s+/g, ' ')
			.trim()
			.substring(0, 120);
	}

	function findCascadeInput() {
		// 复用 bubbles 模块的 findInputEl（更准确的选择器）
		return findInputEl();
	}

	function findSendButton() {
		// 复用 bubbles 模块的 findSendBtnAdvanced（更准确的选择器）
		return findSendBtnAdvanced();
	}

	function findRetryButton() {
		const btns = document.querySelectorAll('button, [role="button"]');
		for (const btn of btns) {
			const txt = (btn.textContent || '').trim().toLowerCase();
			if (txt === 'retry' || txt === '重试' || txt === 'try again' || txt === '再试一次') return btn;
		}
		return null;
	}

	function trackLastUserMessage() {
		// 从 DOM 中提取最后一条用户消息
		const userMsgs = document.querySelectorAll('[data-role="user"], .user-message, [class*="userMessage"]');
		if (userMsgs.length > 0) {
			const last = userMsgs[userMsgs.length - 1];
			const text = (last.textContent || '').trim();
			if (text) lastUserMessage = text;
		}
	}

	function getLatestErrorText() {
		// 扫描聊天区域最近的错误/状态消息
		const errorSelectors = [
			'.error-message',
			'[class*="error"]',
			'[class*="Error"]',
			'[class*="warning"]',
			'[class*="Warning"]',
			'.status-message',
			'[data-testid="error-message"]',
		];
		let latestError = '';
		let latestErrorEl = null;
		
		// 优先查找 .error-message 类的元素
		for (const sel of errorSelectors) {
			const els = document.querySelectorAll(sel);
			if (els.length > 0) {
				const last = els[els.length - 1];
				const text = (last.textContent || '').trim();
				if (text && text.length > 5 && text.length < 500) {
					latestError = text;
					latestErrorEl = last;
					break;
				}
			}
		}
		
		// 备选：扫描最近的聊天气泡内容
		if (!latestError) {
			const msgs = document.querySelectorAll('[data-role="assistant"], .assistant-message, [class*="assistantMessage"]');
			if (msgs.length > 0) {
				const last = msgs[msgs.length - 1];
				const text = (last.textContent || '').trim();
				if (text.length < 500) latestError = text;
			}
		}
		
		return { text: latestError, el: latestErrorEl };
	}

	function sendPoolSignal(type, lastMessage) {
		const signal = { type, ts: Date.now(), lastMessage: lastMessage || lastUserMessage };
		localStorage.setItem('ws-pool-signal', JSON.stringify(signal));
		console.log(LOG_PREFIX + '[Recovery] 发送切号信号: ' + type);
		showRecoveryNotification('正在请求切换账号...');
		setTimeout(() => checkPoolTimeout(signal.ts), 8000);
	}

	function checkPoolTimeout(signalTs) {
		const raw = localStorage.getItem('ws-pool-result');
		if (raw) {
			try {
				const result = JSON.parse(raw);
				if (result.ts >= signalTs) return; // 已收到结果
			} catch {}
		}
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
				console.log(LOG_PREFIX + '[Recovery] 切号成功，等待 session 生效后重试...');
				showRecoveryNotification('切号成功，正在重试...');
				// 切号成功后清理状态，保证切号后是全新的重试计数
				recoveryRetryCount = 0;
				_lastErrorFingerprint = '';
				recordRecoveryLog({ category: 'B', error: '', action: 'switch-result', result: 'switched:' + (result.email || '?') });
				setTimeout(() => {
					retryLastMessage({ afterSwitch: true });
					localStorage.removeItem('ws-pool-result');
					localStorage.removeItem('ws-pool-signal');
				}, 3000);
			} else if (result.type === 'switch-failed') {
				console.log(LOG_PREFIX + '[Recovery] 切号失败: ' + (result.error || ''));
				showRecoveryNotification(result.error || '切换失败，所有账号可能均无额度');
				recordRecoveryLog({ category: 'B', error: '', action: 'switch-result', result: 'failed:' + (result.error || 'unknown') });
				localStorage.removeItem('ws-pool-result');
				localStorage.removeItem('ws-pool-signal');
			}
		} catch {}
	}

	function sendInputAndClick(text) {
		if (!setInputText(text)) return false;
		setTimeout(() => {
			const sendBtn = findSendBtnAdvanced();
			if (sendBtn && !sendBtn.disabled) sendBtn.click();
		}, 500);
		return true;
	}

	function retryLastMessage(opts) {
		opts = opts || {};
		// 优先点击 Retry 按钮（最干净的方式）
		const retryBtn = findRetryButton();
		if (retryBtn) {
			console.log(LOG_PREFIX + '[Recovery] 点击重试按钮');
			retryBtn.click();
			return;
		}
		// 切号后场景：优先发送"继续"避免重做整个原始任务
		if (opts.afterSwitch && settings.continueAfterSwitch) {
			console.log(LOG_PREFIX + '[Recovery] 切号后自动发送"继续"');
			if (sendInputAndClick('继续')) return;
		}
		// 否则重发最后一条用户消息
		if (lastUserMessage) {
			console.log(LOG_PREFIX + '[Recovery] 重发最后一条消息');
			sendInputAndClick(lastUserMessage);
		}
	}

	function showRecoveryNotification(message) {
		// 使用简单的 toast 样式通知
		let toast = document.getElementById('ws-recovery-toast');
		if (!toast) {
			toast = document.createElement('div');
			toast.id = 'ws-recovery-toast';
			toast.style.cssText = 'position:fixed;bottom:60px;right:20px;background:#1a1a2e;color:#e0e0e0;padding:8px 16px;border-radius:8px;font-size:12px;z-index:999999;border:1px solid #333;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;';
			document.body.appendChild(toast);
		}
		toast.textContent = '🔄 ' + message;
		toast.style.opacity = '1';
		setTimeout(() => { if (toast) toast.style.opacity = '0'; }, 5000);
	}

	// ========== 恢复日志 ==========
	const RECOVERY_LOG_KEY = 'ws-recovery-log';
	const RECOVERY_LOG_MAX = 100;
	function recordRecoveryLog(entry) {
		try {
			const raw = localStorage.getItem(RECOVERY_LOG_KEY);
			const list = raw ? JSON.parse(raw) : [];
			list.push(Object.assign({ ts: Date.now() }, entry));
			while (list.length > RECOVERY_LOG_MAX) list.shift();
			localStorage.setItem(RECOVERY_LOG_KEY, JSON.stringify(list));
		} catch {}
	}

	function checkForErrors() {
		if (!settings.autoRecoveryEnabled) return;
		
		const { text: errorText } = getLatestErrorText();
		if (!errorText) return;
		
		// 防抖：同一错误 10 秒内不重复处理
		const now = Date.now();
		if (now - lastRecoveryTs < 10000) return;

		// A 类：可自动重试
		for (const pattern of RETRYABLE_ERRORS) {
			if (pattern.test(errorText)) {
				// 错误指纹比较：不同错误说明上次重试已成功，重置计数
				const fingerprint = makeErrorFingerprint(errorText);
				if (fingerprint !== _lastErrorFingerprint) {
					if (recoveryRetryCount > 0) {
						console.log(LOG_PREFIX + '[Recovery] 检测到新错误，重置重试计数');
					}
					recoveryRetryCount = 0;
					_lastErrorFingerprint = fingerprint;
				}
				if (recoveryRetryCount >= settings.recoveryMaxRetries) {
					console.log(LOG_PREFIX + '[Recovery] 达到最大重试次数');
					showRecoveryNotification('已达最大重试次数 (' + settings.recoveryMaxRetries + ')');
					recoveryRetryCount = 0;
					_lastErrorFingerprint = '';
					recordRecoveryLog({ category: 'A', error: errorText.substring(0, 200), action: 'retry', result: 'gave-up' });
					return;
				}
				recoveryRetryCount++;
				lastRecoveryTs = now;
				const delay = settings.recoveryBaseDelay * recoveryRetryCount;
				console.log(LOG_PREFIX + '[Recovery] A类错误，' + delay + 'ms 后重试 (' + recoveryRetryCount + '/' + settings.recoveryMaxRetries + ')');
				showRecoveryNotification('错误检测到，' + Math.round(delay / 1000) + 's 后重试...');
				recordRecoveryLog({ category: 'A', error: errorText.substring(0, 200), action: 'retry', result: 'scheduled', delay, attempt: recoveryRetryCount });
				setTimeout(() => {
					const retryBtn = findRetryButton();
					if (retryBtn) retryBtn.click();
				}, delay);
				return;
			}
		}

		// B 类：需要切号
		for (const { pattern, signal } of SWITCHABLE_ERRORS) {
			if (pattern.test(errorText)) {
				lastRecoveryTs = now;
				recoveryRetryCount = 0;
				_lastErrorFingerprint = '';
				// 检查设置是否允许
				const isQuota = signal === 'quota-exhausted' || signal === 'quota-daily-exhausted';
				const isRate = signal === 'rate-limited' || signal === 'provider-overloaded' || signal === 'provider-unavailable';
				if (isQuota && !settings.autoSwitchOnQuota) {
					console.log(LOG_PREFIX + '[Recovery] B类错误(额度)但设置关闭，跳过');
					recordRecoveryLog({ category: 'B', error: errorText.substring(0, 200), action: 'switch:' + signal, result: 'skipped-by-setting' });
					return;
				}
				if (isRate && !settings.autoSwitchOnRateLimit) {
					console.log(LOG_PREFIX + '[Recovery] B类错误(限流)但设置关闭，跳过');
					recordRecoveryLog({ category: 'B', error: errorText.substring(0, 200), action: 'switch:' + signal, result: 'skipped-by-setting' });
					return;
				}
				console.log(LOG_PREFIX + '[Recovery] B类错误，发送切号信号: ' + signal);
				recordRecoveryLog({ category: 'B', error: errorText.substring(0, 200), action: 'switch:' + signal, result: 'signal-sent' });
				sendPoolSignal(signal, lastUserMessage);
				return;
			}
		}

		// D 类：仅通知（用户需介入）
		for (const { pattern, hint } of NOTIFY_ONLY) {
			if (pattern.test(errorText)) {
				console.log(LOG_PREFIX + '[Recovery] D类通知: ' + errorText.substring(0, 60));
				showRecoveryNotification(hint || errorText.substring(0, 80));
				recordRecoveryLog({ category: 'D', error: errorText.substring(0, 200), action: 'notify', result: hint || 'notified' });
				return;
			}
		}
	}

	let _lastContinueTs = 0;
	function checkForContinuePrompts() {
		if (!settings.autoSendContinue) return;
		// 冷却期：避免同一上限提示反复触发
		if (Date.now() - _lastContinueTs < 15000) return;

		// 1) text-equals 类型：仅在按钮上匹配
		const btns = document.querySelectorAll('button, [role="button"]');
		for (const btn of btns) {
			const txt = (btn.textContent || '').trim();
			for (const trigger of CONTINUE_TRIGGERS) {
				if (trigger.text && txt === trigger.text && trigger.action === 'click') {
					// 已由 autoContinue 模块处理
					return;
				}
			}
		}

		// 2) pattern 类型（工具调用上限等）：扫描消息文本，不仅限于按钮
		const patternTriggers = CONTINUE_TRIGGERS.filter(t => t.pattern && t.action === 'send-continue');
		if (patternTriggers.length === 0) return;

		const messageSelectors = [
			'[class*="message"]', '[class*="Message"]',
			'[class*="error"]', '[class*="Error"]',
			'[class*="warning"]', '[class*="Warning"]',
			'[class*="status"]', '[class*="notice"]',
			'[role="alert"]', '[role="status"]',
			'.markdown-body', '.chat-message-content',
		];
		const seen = new Set();
		const candidates = [];
		for (const sel of messageSelectors) {
			document.querySelectorAll(sel).forEach(el => {
				if (seen.has(el)) return;
				seen.add(el);
				candidates.push(el);
			});
		}
		// 取最近的 30 个候选元素，避免全文档扫描
		const recent = candidates.slice(-30);
		for (const el of recent) {
			const txt = (el.textContent || '').trim();
			if (!txt || txt.length > 600) continue;
			for (const trigger of patternTriggers) {
				if (trigger.pattern.test(txt)) {
					console.log(LOG_PREFIX + '[Recovery] 工具上限/截断，自动发送 continue');
					recordRecoveryLog({ category: 'C', error: txt.substring(0, 200), action: 'send-continue', result: 'sent' });
					_lastContinueTs = Date.now();
					if (setInputText('continue')) {
						setTimeout(() => {
							const sendBtn = findSendBtnAdvanced();
							if (sendBtn) sendBtn.click();
						}, 500);
					}
					return;
				}
			}
		}
	}

	function checkForWebRequestApproval() {
		if (!settings.autoApproveWebRequests) return;
		// 查找 Web 请求批准按钮
		const btns = document.querySelectorAll('button, [role="button"]');
		for (const btn of btns) {
			const txt = (btn.textContent || '').trim().toLowerCase();
			if (txt === 'allow' || txt === '允许' || txt === 'approve' || txt === '批准') {
				const parent = btn.closest('[class*="web-request"], [class*="approval"], [class*="permission"]');
				if (parent) {
					console.log(LOG_PREFIX + '[Recovery] 自动批准 Web 请求');
					btn.click();
					return;
				}
			}
		}
	}

	let recoveryPollTimer = null;
	function startAutoRecovery() {
		if (recoveryObserver) { recoveryObserver.disconnect(); recoveryObserver = null; }
		if (recoveryPollTimer) { clearInterval(recoveryPollTimer); recoveryPollTimer = null; }
		if (!settings.autoRecoveryEnabled) return;

		// MutationObserver 驱动错误检测
		let debounceTimer = null;
		recoveryObserver = new MutationObserver(() => {
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				trackLastUserMessage();
				checkForErrors();
				checkForContinuePrompts();
				checkForWebRequestApproval();
				checkForPoolResult();
			}, 500);
		});
		recoveryObserver.observe(document.body, { childList: true, subtree: true });

		// 定时轮询 pool result（兜底）
		recoveryPollTimer = setInterval(() => {
			if (settings.autoRecoveryEnabled) checkForPoolResult();
		}, 3000);

		console.log(LOG_PREFIX + '[Recovery] ✅自动恢复已启用');
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

	let notifyObserver = null;
	let _lastAssistantCount = 0;
	let _wasGenerating = false;

	function startNotifyObserver() {
		if (notifyObserver) { notifyObserver.disconnect(); notifyObserver = null; }
		if (!settings.notifyEnabled) return;

		// 初始计数
		_lastAssistantCount = document.querySelectorAll('[data-role="assistant"], .assistant-message, [class*="assistantMessage"]').length;
		_wasGenerating = false;

		let debounceTimer = null;
		notifyObserver = new MutationObserver(() => {
			if (!settings.notifyEnabled) return;
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => checkCompletion(), 800);
		});
		notifyObserver.observe(document.body, { childList: true, subtree: true });
		console.log(LOG_PREFIX + '[Notify] ✅完成提醒已启用');
	}

	function isGenerating() {
		// 检测是否正在生成：查找 stop 按钮、加载动画等
		const stopSelectors = [
			'button[aria-label="Stop"]',
			'button[aria-label="停止"]',
			'button[data-testid="stop-button"]',
			'.stop-button',
		];
		for (const sel of stopSelectors) {
			if (document.querySelector(sel)) return true;
		}
		// 检测加载指示器
		const loaders = document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="generating"]');
		for (const l of loaders) {
			const r = l.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) return true;
		}
		return false;
	}

	function checkCompletion() {
		if (!settings.notifyEnabled) return;
		const generating = isGenerating();
		
		if (_wasGenerating && !generating) {
			// 刚刚从生成状态变为非生成状态 → 完成
			const shouldNotify = shouldTriggerNotify();
			if (shouldNotify) {
				console.log(LOG_PREFIX + '[Notify] AI 回复完成，触发提醒');
				// 通过 localStorage 信号通知扩展后端播放系统声音
				try {
					localStorage.setItem('ws-pool-notify', JSON.stringify({
						ts: Date.now(),
						sound: !!settings.notifySound,
						desktop: !!settings.notifyDesktop,
						tone: settings.notifyTone || 'funk',
						repeat: settings.notifyRepeat || 2,
						customTone: settings.customTone || '',
						audioFile: settings.audioFile || '',
						title: 'Cascade 完成',
						body: 'AI 回复已完成',
					}));
				} catch(e) {}
				// 同时尝试本地播放（作为备用，可能因 autoplay 限制而静音）
				if (settings.notifySound) playNotifySound();
				if (settings.notifyDesktop) sendDesktopNotify('Cascade 完成', 'AI 回复已完成');
			}
		}
		
		_wasGenerating = generating;
		// 更新助手消息计数
		_lastAssistantCount = document.querySelectorAll('[data-role="assistant"], .assistant-message, [class*="assistantMessage"]').length;
	}

	function shouldTriggerNotify() {
		const trigger = settings.notifyTrigger || 'always';
		switch (trigger) {
			case 'always': return true;
			case 'error': {
				// 仅在有错误时触发
				const { text } = getLatestErrorText();
				if (!text) return false;
				for (const p of RETRYABLE_ERRORS) { if (p.test(text)) return true; }
				for (const { pattern } of SWITCHABLE_ERRORS) { if (pattern.test(text)) return true; }
				for (const { pattern } of NOTIFY_ONLY) { if (pattern.test(text)) return true; }
				return false;
			}
			case 'idle': {
				// 仅在窗口不活跃时触发
				return document.hidden || !document.hasFocus();
			}
			default: return true;
		}
	}
	
	// ========== 初始化 ==========
	function init() {
		console.log('🚀 Windsurf Better v' + VERSION + ' 初始化');
		// Settings UI moved to sidebar panel; only inject styles for bubbles
		injectBubblesStyles();
		dismissCorruptWarning();
		if (settings.autoContinueEnabled) startAutoContinue();
		if (settings.autoRecoveryEnabled) startAutoRecovery();
		if (settings.notifyEnabled) startNotifyObserver();
		
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

		// 监听 localStorage 变化（侧栏设置面板同步）
		window.addEventListener('storage', (e) => {
			if (e.key !== STORAGE_KEY) return;
			const newSettings = loadSettings();
			const old = { ...settings };
			Object.assign(settings, newSettings);
			// 响应回复建议开关变化
			if (old.bubblesEnabled !== settings.bubblesEnabled) {
				if (settings.bubblesEnabled) startBubblesObserving();
				else if (bubblesObserver) { bubblesObserver.disconnect(); bubblesObserver = null; }
			}
			// 响应汉化开关变化
			if (old.localizationEnabled !== settings.localizationEnabled) {
				if (settings.localizationEnabled) { startLocalizationObserver(); enqueue(document.body); }
				else if (localizationObserver) { localizationObserver.disconnect(); localizationObserver = null; }
			}
			// 响应自动继续开关变化
			if (old.autoContinueEnabled !== settings.autoContinueEnabled) {
				if (settings.autoContinueEnabled) startAutoContinue();
				else if (autoContinueObserver) { autoContinueObserver.disconnect(); autoContinueObserver = null; }
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
			console.log(LOG_PREFIX + ' 设置已从侧栏同步');
		});
	}
	
	if (document.readyState === 'loading') {
		window.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
	} else {
		setTimeout(init, 800);
	}
})();
