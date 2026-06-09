export const BYOK_FEATURE_IN_DEVELOPMENT = true;

export const BYOK_DEVELOPMENT_NOTICE =
  'BYOK 功能正在开发中，当前版本暂不开放配置、启动 Sidecar 或应用 Patch。';

const BLOCKED_WEBVIEW_MESSAGES = new Set([
  'byokStart',
  'byokSaveProvider',
  'byokDeleteProvider',
  'byokTestProvider',
  'byokSaveSlot',
  'byokSaveModelMapSettings',
  'byokSaveInjected',
  'byokDeleteSlot',
  'byokApplyPatch',
]);

export function isByokDevelopmentBlockedMessage(type: string): boolean {
  return BYOK_FEATURE_IN_DEVELOPMENT && BLOCKED_WEBVIEW_MESSAGES.has(type);
}
