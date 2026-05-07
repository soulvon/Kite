import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const RULES_MARKER_START = '<!-- ws-better-rules-start -->';
const RULES_MARKER_END = '<!-- ws-better-rules-end -->';

/**
 * 获取 .windsurfrules 文件路径（全局）
 */
function getGlobalRulesPath(): string {
  return path.join(os.homedir(), '.windsurfrules');
}

/**
 * 获取回复建议提示规则模板内容
 */
function getBubbleRulesContent(): string | null {
  const ext = vscode.extensions.getExtension('local.windsurf-pool');
  if (!ext) return null;
  const rulesPath = path.join(ext.extensionPath, 'resources', 'bubble-rules.md');
  if (!fs.existsSync(rulesPath)) return null;
  return fs.readFileSync(rulesPath, 'utf8');
}

/**
 * 检查全局规则是否已包含回复建议提示词
 * 只检查自有 marker，避免误判用户手动添加的 :::bubbles 示例
 */
export function hasBubbleRules(): boolean {
  const rulesPath = getGlobalRulesPath();
  if (!fs.existsSync(rulesPath)) return false;
  const content = fs.readFileSync(rulesPath, 'utf8');
  return content.includes(RULES_MARKER_START);
}

/**
 * 注入回复建议提示规则到全局 .windsurfrules
 * @returns true = 成功注入, false = 已存在或失败
 */
export function injectBubbleRules(): { injected: boolean; error?: string } {
  try {
    const rulesContent = getBubbleRulesContent();
    if (!rulesContent) {
      return { injected: false, error: '未找到规则模板文件' };
    }

    const rulesPath = getGlobalRulesPath();
    let existing = '';

    if (fs.existsSync(rulesPath)) {
      existing = fs.readFileSync(rulesPath, 'utf8');

      // 已存在 marker → 先删除旧版本再重新注入（实现"更新"语义）
      if (existing.includes(RULES_MARKER_START)) {
        const startIdx = existing.indexOf(RULES_MARKER_START);
        const endIdx = existing.indexOf(RULES_MARKER_END);
        if (endIdx >= 0) {
          const before = existing.substring(0, startIdx);
          const after = existing.substring(endIdx + RULES_MARKER_END.length);
          existing = before.trimEnd() + after.trimStart();
        }
      }
    }

    // 组装内容
    const block = `\n\n${RULES_MARKER_START}\n${rulesContent}\n${RULES_MARKER_END}\n`;
    const newContent = existing.trimEnd() + block;

    fs.writeFileSync(rulesPath, newContent, 'utf8');
    return { injected: true };
  } catch (err) {
    return { injected: false, error: String(err) };
  }
}

/**
 * 移除回复建议提示规则
 */
export function removeBubbleRules(): boolean {
  const rulesPath = getGlobalRulesPath();
  if (!fs.existsSync(rulesPath)) return false;

  let content = fs.readFileSync(rulesPath, 'utf8');
  if (!content.includes(RULES_MARKER_START)) return false;

  const startIdx = content.indexOf(RULES_MARKER_START);
  const endIdx = content.indexOf(RULES_MARKER_END);
  if (endIdx < 0) return false;

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx + RULES_MARKER_END.length);
  content = (before.trimEnd() + '\n' + after.trimStart()).trim();

  if (content) {
    fs.writeFileSync(rulesPath, content + '\n', 'utf8');
  } else {
    // 文件为空则删除
    fs.unlinkSync(rulesPath);
  }
  return true;
}

/**
 * 激活时自动检查并注入（静默）
 */
export function ensureBubbleRules(): void {
  const enabled = vscode.workspace.getConfiguration('windsurfPool.enhancement').get<boolean>('enabled', true);
  if (!enabled) return;

  if (!hasBubbleRules()) {
    const result = injectBubbleRules();
    if (result.injected) {
      console.log('[windsurf-pool] 智能建议规则已自动注入到 ~/.windsurfrules');
    }
  }
}
