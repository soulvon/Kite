import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 规则种类定义。每种规则有独立的 marker 对和模板文件，
 * 可独立检测 / 注入 / 移除，互不干扰。
 */
type RuleKind = 'bubble' | 'scriptDiscipline';

interface RuleMeta {
  start: string;
  end: string;
  filename: string;
  label: string;
}

const RULE_META: Record<RuleKind, RuleMeta> = {
  bubble: {
    start: '<!-- ws-better-rules-start -->',
    end: '<!-- ws-better-rules-end -->',
    filename: 'bubble-rules.md',
    label: '智能建议规则',
  },
  scriptDiscipline: {
    start: '<!-- ws-better-script-discipline-start -->',
    end: '<!-- ws-better-script-discipline-end -->',
    filename: 'script-discipline-rules.md',
    label: '脚本纪律规则',
  },
};

/**
 * 获取 .windsurfrules 文件路径（全局）
 */
function getGlobalRulesPath(): string {
  return path.join(os.homedir(), '.windsurfrules');
}

function getRuleContent(kind: RuleKind): string | null {
  const ext = vscode.extensions.getExtension('local.kite') || vscode.extensions.getExtension('local.windsurf-pool');
  if (!ext) return null;
  const rulesPath = path.join(ext.extensionPath, 'resources', RULE_META[kind].filename);
  if (!fs.existsSync(rulesPath)) return null;
  return fs.readFileSync(rulesPath, 'utf8');
}

/**
 * 通用：检查指定规则是否已注入
 * 只检查自有 marker，避免误判用户手动添加的示例
 */
function hasRules(kind: RuleKind): boolean {
  const rulesPath = getGlobalRulesPath();
  if (!fs.existsSync(rulesPath)) return false;
  const content = fs.readFileSync(rulesPath, 'utf8');
  return content.includes(RULE_META[kind].start);
}

/**
 * 通用：注入指定规则到全局 .windsurfrules
 * 已存在同 marker 时执行"更新"语义（先剥离旧块再追加新块）
 */
function injectRules(kind: RuleKind): { injected: boolean; error?: string } {
  try {
    const rulesContent = getRuleContent(kind);
    if (!rulesContent) {
      return { injected: false, error: `未找到规则模板文件 (${RULE_META[kind].filename})` };
    }

    const meta = RULE_META[kind];
    const rulesPath = getGlobalRulesPath();
    let existing = '';

    if (fs.existsSync(rulesPath)) {
      existing = fs.readFileSync(rulesPath, 'utf8');

      // 已存在 marker → 先删除旧版本再重新注入（实现"更新"语义）
      if (existing.includes(meta.start)) {
        const startIdx = existing.indexOf(meta.start);
        const endIdx = existing.indexOf(meta.end);
        if (endIdx >= 0) {
          const before = existing.substring(0, startIdx);
          const after = existing.substring(endIdx + meta.end.length);
          existing = before.trimEnd() + after.trimStart();
        }
      }
    }

    // 组装内容
    const block = `\n\n${meta.start}\n${rulesContent}\n${meta.end}\n`;
    const newContent = existing.trimEnd() + block;

    fs.writeFileSync(rulesPath, newContent, 'utf8');
    return { injected: true };
  } catch (err) {
    return { injected: false, error: String(err) };
  }
}

/**
 * 通用：移除指定规则
 */
function removeRules(kind: RuleKind): boolean {
  const rulesPath = getGlobalRulesPath();
  if (!fs.existsSync(rulesPath)) return false;

  const meta = RULE_META[kind];
  let content = fs.readFileSync(rulesPath, 'utf8');
  if (!content.includes(meta.start)) return false;

  const startIdx = content.indexOf(meta.start);
  const endIdx = content.indexOf(meta.end);
  if (endIdx < 0) return false;

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + meta.end.length);
  content = (before.trimEnd() + '\n' + after.trimStart()).trim();

  if (content) {
    fs.writeFileSync(rulesPath, content + '\n', 'utf8');
  } else {
    // 文件为空则删除
    fs.unlinkSync(rulesPath);
  }
  return true;
}

// ========== 气泡规则（保留原 API 以兼容现有调用方） ==========

export function hasBubbleRules(): boolean {
  return hasRules('bubble');
}

export function injectBubbleRules(): { injected: boolean; error?: string } {
  return injectRules('bubble');
}

export function removeBubbleRules(): boolean {
  return removeRules('bubble');
}

// ========== 脚本纪律规则 ==========

export function hasScriptDisciplineRules(): boolean {
  return hasRules('scriptDiscipline');
}

export function injectScriptDisciplineRules(): { injected: boolean; error?: string } {
  return injectRules('scriptDiscipline');
}

export function removeScriptDisciplineRules(): boolean {
  return removeRules('scriptDiscipline');
}

// ========== 聚合操作 ==========

/**
 * 启用增强时：确保所有增强相关规则都已注入（缺什么补什么）
 */
export function ensureAllEnhancementRules(): void {
  const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', false);
  if (!enabled) return;

  if (!hasBubbleRules()) {
    const r = injectBubbleRules();
    if (r.injected) console.log('[kite] 智能建议规则已自动注入到 ~/.windsurfrules');
  }
  if (!hasScriptDisciplineRules()) {
    const r = injectScriptDisciplineRules();
    if (r.injected) console.log('[kite] 脚本纪律规则已自动注入到 ~/.windsurfrules');
  }
}

/**
 * 关闭增强时：移除所有增强相关规则
 */
export function removeAllEnhancementRules(): void {
  try { removeBubbleRules(); } catch {}
  try { removeScriptDisciplineRules(); } catch {}
}

/**
 * @deprecated 请使用 ensureAllEnhancementRules()；此别名保留仅为兼容旧调用方
 */
export function ensureBubbleRules(): void {
  ensureAllEnhancementRules();
}
