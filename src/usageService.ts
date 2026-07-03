import { StoredAccount, UsageSnapshot } from './types';
import { post } from './httpClient';
import { cascadeProbe, LsInfo } from './cascadeProbe';
import { getIdeDisplayName } from './ideDetector';

/** Cascade canary probe 开关。现在走隔离 LS，不写入桌面 Windsurf 会话目录。 */
let _cascadeProbeEnabled = false;
let _cascadeProbeMessage = '你好';

export function setCascadeProbeEnabled(enabled: boolean): void {
  _cascadeProbeEnabled = enabled;
}

export function isCascadeProbeEnabled(): boolean {
  return _cascadeProbeEnabled;
}

export function setCascadeProbeMessage(message: string): void {
  _cascadeProbeMessage = (message || '你好').trim().slice(0, 200) || '你好';
}

/** 探测模型信息（动态从 Windsurf 本地 state DB 读取） */
export interface ProbeModelInfo {
  label: string;      // 显示名（与 Windsurf 下拉一致）
  uid: string;        // 内部 UID（kebab-case，用作 chatModelName）
}

export const DEFAULT_CASCADE_CHECK_MODEL: ProbeModelInfo = {
  label: 'Claude Sonnet 4.6',
  uid: 'claude-sonnet-4-6',
};

function formatResetSeconds(seconds: any): string {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60) return `${Math.ceil(n)} 秒`;
  if (n < 3600) return `${Math.ceil(n / 60)} 分钟`;
  return `${Math.ceil(n / 3600)} 小时`;
}

function formatEtaFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const eta = new Date(Date.now() + ms);
  const time = eta.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const today = new Date();
  const etaDay = new Date(eta.getFullYear(), eta.getMonth(), eta.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (etaDay === todayDay) return time;
  if (etaDay === todayDay + 24 * 60 * 60 * 1000) return `明天 ${time}`;
  return eta.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function parseResetTextToMs(text?: string): number {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return 0;
  let total = 0;
  const add = (value: string | undefined, unitMs: number) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) total += n * unitMs;
  };
  const compact = raw.match(/(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?/);
  if (compact && (compact[1] || compact[2] || compact[3])) {
    add(compact[1], 3600_000);
    add(compact[2], 60_000);
    add(compact[3], 1000);
    return total;
  }
  const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|小时|h|minutes?|mins?|分钟|m|seconds?|secs?|秒|s)/g)];
  for (const m of matches) {
    const unit = m[2];
    if (/^h|hour|hr|小时/.test(unit)) add(m[1], 3600_000);
    else if (/^m|minute|min|分钟/.test(unit)) add(m[1], 60_000);
    else if (/^s|second|sec|秒/.test(unit)) add(m[1], 1000);
  }
  return total;
}

function formatResetEta(seconds: any, resetText?: string): string {
  const sec = Number(seconds);
  const ms = Number.isFinite(sec) && sec > 0 ? sec * 1000 : parseResetTextToMs(resetText);
  const eta = formatEtaFromMs(ms);
  return eta ? `，预计 ${eta} 恢复` : '';
}

function parseRateLimitBody(body: string): { ok: boolean; reason?: string; remaining?: number | null } {
  let d: any = {};
  try { d = JSON.parse(body || '{}'); } catch { return { ok: true, remaining: null }; }

  const msg = String(d.message || d.error || '');
  const reset = formatResetSeconds(d.resetsInSeconds);
  const resetEta = formatResetEta(d.resetsInSeconds);
  if (msg && /message limit|rate limit|reached/i.test(msg)) {
    const isModelLimit = /for this model/i.test(msg);
    const upgradeHint = /upgrade to pro|try a different model/i.test(msg);
    return {
      ok: false,
      reason: reset
        ? `${isModelLimit ? getIdeDisplayName() + ' 官方模型额度限制' : getIdeDisplayName() + ' 官方消息频率限制'}，约 ${reset} 后恢复${resetEta}`
        : isModelLimit
          ? `${getIdeDisplayName()} 官方模型额度已达上限${upgradeHint ? '，可换模型或等待刷新' : ''}（服务端未返回恢复时间）`
          : `${getIdeDisplayName()} 官方消息频率限制（服务端未返回恢复时间）`,
      remaining: 0,
    };
  }

  if (d.hasCapacity === false) {
    return { ok: false, reason: `${getIdeDisplayName()} 官方消息额度已用尽`, remaining: 0 };
  }

  if (typeof d.messagesRemaining === 'number') {
    if (d.messagesRemaining === 0) return { ok: false, reason: `${getIdeDisplayName()} 官方消息额度剩余 0 条`, remaining: 0 };
    return { ok: true, remaining: d.messagesRemaining };
  }

  return { ok: true, remaining: null };
}

function formatProbeLimitReason(tag: string, planName: string, probe: {
  limitKind?: string;
  resetText?: string;
  traceId?: string;
  detail?: string;
}): string {
  const plan = planName || 'Unknown';
  const kind = probe.limitKind || (probe.detail && /overall/i.test(probe.detail) ? 'overall' : 'unknown');
  const hasReset = !!probe.resetText;
  const label = kind === 'overall'
    ? (hasReset ? '官方临时限流' : '官方全局限制/长期不可用')
    : kind === 'model'
      ? `${getIdeDisplayName()} 官方模型限流`
      : kind === 'message'
        ? `${getIdeDisplayName()} 官方消息限流`
        : `${getIdeDisplayName()} 官方频率限制`;
  const parts = [`${tag}${label} [${plan}]`];
  if (kind === 'overall') {
    parts.push('overall message rate limit');
    parts.push(hasReset ? '服务端返回恢复时间，按临时冷却处理' : '服务端未返回恢复时间，疑似账号级全模型限制');
  }
  if (probe.resetText) parts.push(`恢复时间 ${probe.resetText}`);
  const eta = formatResetEta(undefined, probe.resetText);
  if (eta) parts.push(`预计 ${eta.replace(/^，预计\s*/, '')}`);
  if (probe.traceId) parts.push(`Trace ${probe.traceId}`);
  if (probe.detail) parts.push(`服务端: ${probe.detail}`);
  return parts.join(' | ');
}

export async function checkCascadeSendReady(
  account: StoredAccount,
  model: ProbeModelInfo = DEFAULT_CASCADE_CHECK_MODEL
): Promise<{ ok: boolean; reason?: string; status?: number }> {
  const baseUrl = (account.apiServerUrl || 'https://server.codeium.com').replace(/\/$/, '');
  const headers = { 'Connect-Protocol-Version': '1', 'Accept': 'application/json' };
  const meta = {
    apiKey: account.apiKey,
    ideName: 'windsurf',
    ideVersion: '0.0.0',
    extensionName: 'windsurf-next',
    extensionVersion: '1.0.0',
    locale: 'en'
  };
  const modelUid = UID_PROTO_MAP[model.uid] || model.uid;

  try {
    const r = await post(
      `${baseUrl}/exa.api_server_pb.ApiServerService/CheckUserMessageRateLimit`,
      { metadata: meta, modelUid },
      headers
    );
    if (r.status === 401) return { ok: false, reason: 'Key 已失效 (401)', status: r.status };
    if (r.status === 403) return { ok: false, reason: '账号无权限/封禁 (403)', status: r.status };
    if (r.status !== 200) return { ok: false, reason: `限速检测异常 (${r.status})`, status: r.status };
    const parsed = parseRateLimitBody(r.body);
    return { ok: parsed.ok, reason: parsed.reason, status: r.status };
  } catch (err: any) {
    return { ok: false, reason: `限速检测失败: ${err?.message || err}` };
  }
}

/**
 * State DB kebab-uid → 云端 GetUserStatus 返回的 proto model name 映射。
 * 数据来源：WindsurfAPI/src/models.js (dwgx/WindsurfAPI)
 * cascadeAllowedModelsConfig[].modelOrAlias.model 使用这些 proto 名称。
 */
const UID_PROTO_MAP: Record<string, string> = {
  // ── Claude ──
  'claude-4-sonnet':            'MODEL_CLAUDE_4_SONNET',
  'claude-4-sonnet-thinking':   'MODEL_CLAUDE_4_SONNET_THINKING',
  'claude-4-opus':              'MODEL_CLAUDE_4_OPUS',
  'claude-4-opus-thinking':     'MODEL_CLAUDE_4_OPUS_THINKING',
  'claude-4-1-opus':            'MODEL_CLAUDE_4_1_OPUS',
  'claude-4-1-opus-thinking':   'MODEL_CLAUDE_4_1_OPUS_THINKING',
  'claude-4-5-haiku':           'MODEL_PRIVATE_11',
  'claude-4-5-sonnet':          'MODEL_PRIVATE_2',
  'claude-4-5-sonnet-thinking': 'MODEL_PRIVATE_3',
  'claude-4-5-opus':            'MODEL_CLAUDE_4_5_OPUS',
  'claude-4-5-opus-thinking':   'MODEL_CLAUDE_4_5_OPUS_THINKING',
  // Windsurf 2.2.x UI 显示为 4.6，GetUserStatus 当前用 PRIVATE_2/3 表示 Sonnet 4.6。
  'claude-sonnet-4-6':          'MODEL_PRIVATE_2',
  'claude-sonnet-4-6-thinking': 'MODEL_PRIVATE_3',
  'claude-opus-4-6':            'MODEL_CLAUDE_4_5_OPUS',
  'claude-opus-4-6-thinking':   'MODEL_CLAUDE_4_5_OPUS_THINKING',
  // ── GPT ──
  'gpt-4o':                     'MODEL_CHAT_GPT_4O_2024_08_06',
  'gpt-4-1':                    'MODEL_CHAT_GPT_4_1_2025_04_14',
  'gpt-4-1-mini':               'MODEL_CHAT_GPT_4_1_MINI_2025_04_14',
  'gpt-5':                      'MODEL_PRIVATE_6',
  'gpt-5-medium':               'MODEL_PRIVATE_7',
  'gpt-5-high':                 'MODEL_PRIVATE_8',
  'gpt-5-codex':                'MODEL_CHAT_GPT_5_CODEX',
  'gpt-5-nano':                 'MODEL_GPT_5_NANO',
  'gpt-5-2':                    'MODEL_GPT_5_2_MEDIUM',
  'gpt-5-2-none':               'MODEL_GPT_5_2_NONE',
  'gpt-5-2-low':                'MODEL_GPT_5_2_LOW',
  'gpt-5-2-high':               'MODEL_GPT_5_2_HIGH',
  'gpt-5-2-xhigh':              'MODEL_GPT_5_2_XHIGH',
  'gpt-5-1':                    'MODEL_PRIVATE_12',
  // Windsurf 配置中 GPT-5.5 的可用检测必须走具体 effort UID；裸 gpt-5.5 会返回 -1 并造成误判。
  'gpt-5.4':                    'gpt-5-4-low',
  'gpt-5-4':                    'gpt-5-4-low',
  'gpt-5-4-none':               'gpt-5-4-none',
  'gpt-5-4-low':                'gpt-5-4-low',
  'gpt-5-4-medium':             'gpt-5-4-medium',
  'gpt-5-4-high':               'gpt-5-4-high',
  'gpt-5-4-xhigh':              'gpt-5-4-xhigh',
  'gpt-5-4-none-priority':      'gpt-5-4-none-priority',
  'gpt-5-4-low-priority':       'gpt-5-4-low-priority',
  'gpt-5-4-medium-priority':    'gpt-5-4-medium-priority',
  'gpt-5-4-high-priority':      'gpt-5-4-high-priority',
  'gpt-5-4-xhigh-priority':     'gpt-5-4-xhigh-priority',
  'gpt-5.4-mini':               'gpt-5-4-mini-low',
  'gpt-5-4-mini-low':           'gpt-5-4-mini-low',
  'gpt-5-4-mini-medium':        'gpt-5-4-mini-medium',
  'gpt-5-4-mini-high':          'gpt-5-4-mini-high',
  'gpt-5-4-mini-xhigh':         'gpt-5-4-mini-xhigh',
  'gpt-5.5':                    'gpt-5-5-low',
  'gpt-5-5':                    'gpt-5-5-low',
  'gpt-5-5-none':               'gpt-5-5-none',
  'gpt-5-5-low':                'gpt-5-5-low',
  'gpt-5-5-medium':             'gpt-5-5-medium',
  'gpt-5-5-high':               'gpt-5-5-high',
  'gpt-5-5-xhigh':              'gpt-5-5-xhigh',
  'gpt-5-5-none-priority':      'gpt-5-5-none-priority',
  'gpt-5-5-low-priority':       'gpt-5-5-low-priority',
  'gpt-5-5-medium-priority':    'gpt-5-5-medium-priority',
  'gpt-5-5-high-priority':      'gpt-5-5-high-priority',
  'gpt-5-5-xhigh-priority':     'gpt-5-5-xhigh-priority',
  'gpt-5-5-review':             'gpt-5-5-review',
  // ── O-series ──
  'o3':                         'MODEL_CHAT_O3',
  'o3-high':                    'MODEL_CHAT_O3_HIGH',
  // ── Gemini ──
  'gemini-2-5-pro':             'MODEL_GOOGLE_GEMINI_2_5_PRO',
  'gemini-2-5-flash':           'MODEL_GOOGLE_GEMINI_2_5_FLASH',
  'gemini-2-5-flash-thinking':  'MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING',
  'gemini-3-0-flash':           'MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM',
  'gemini-3-0-flash-low':       'MODEL_GOOGLE_GEMINI_3_0_FLASH_LOW',
  'gemini-3-0-flash-high':      'MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH',
  // ── Grok ──
  'grok-3':                     'MODEL_XAI_GROK_3',
  'grok-3-mini-thinking':       'MODEL_XAI_GROK_3_MINI_REASONING',
  // ── SWE ──
  'swe-1-5':                    'MODEL_SWE_1_5_SLOW',
  'swe-1-5-fast':               'MODEL_SWE_1_5',
  'swe-1-6':                    'MODEL_SWE_1_6',
  'swe-1-6-fast':               'MODEL_SWE_1_6_FAST',
  // ── GLM ──
  'glm-4-7':                    'MODEL_GLM_4_7',
  'glm-5.1':                    'glm-5-1',
  'glm-5-1':                    'glm-5-1',
  // ── Kimi ──
  'kimi-k2':                    'MODEL_KIMI_K2',
  'kimi-k2.5':                  'kimi-k2-5',
  'kimi-k2-5':                  'kimi-k2-5',
  'kimi-k2.6':                  'kimi-k2-6',
  'kimi-k2-6':                  'kimi-k2-6',
  // ── MiniMax ──
  'minimax-m2-5':               'MODEL_MINIMAX_M2_1',
  // ── Current Windsurf UID-only models ──
  'claude-sonnet-4-6-1m':          'claude-sonnet-4-6-1m',
  'claude-sonnet-4-6-thinking-1m': 'claude-sonnet-4-6-thinking-1m',
  'gemini-3-pro':                  'gemini-3-pro',
  'gemini-3.0-flash':              'gemini-3-0-flash',
  'gemini-3-1-pro-low':            'gemini-3-1-pro-low',
  'gemini-3-1-pro-high':           'gemini-3-1-pro-high',
  'gemini-3.1-pro':                'gemini-3-1-pro-low',
  'gemini-3-1-pro':                'gemini-3-1-pro-low',
};

/**
 * 检测账号是否正常 + 模型权限 + 真实剩余消息数
 *
 * 双 API 并行调用：
 *   1. SeatManagementService/GetUserStatus → 账号状态、套餐、cascadeAllowedModelsConfig
 *   2. ApiServerService/CheckUserMessageRateLimit → 真实剩余消息数（per-model）
 *
 * 服务路径说明：
 *   ✅ exa.api_server_pb.ApiServerService/CheckUserMessageRateLimit — 云端可用，接受 modelUid
 *   ❌ exa.language_server_pb.LanguageServerService/CheckUserMessageRateLimit — 云端 404
 */
export async function testModelAccess(
  account: StoredAccount,
  model?: ProbeModelInfo,
  signal?: AbortSignal,
  probeMessage?: string,
  lsInfo?: LsInfo
): Promise<{ ok: boolean; reason?: string; status?: number; raw?: string }> {
  if (!account.apiKey) {
    return { ok: false, reason: '缺少 apiKey，请使用命令面板 "Kite: 修复缺失凭据" 或重新导入账号' };
  }
  const baseUrl = (account.apiServerUrl || 'https://server.codeium.com').replace(/\/$/, '');
  const headers = { 'Connect-Protocol-Version': '1', 'Accept': 'application/json' };
  const meta = {
    apiKey: account.apiKey,
    ideName: 'windsurf',
    ideVersion: '0.0.0',
    extensionName: 'windsurf-next',
    extensionVersion: '1.0.0',
    locale: 'en'
  };

  if (signal?.aborted) return { ok: false, reason: '已取消' };

  const tag = model ? `${model.label}: ` : '';

  // 查找选中模型用于 CheckRateLimit 的 UID
  const rateLimitUid = model ? (UID_PROTO_MAP[model.uid] || model.uid) : '';

  try {
    // ── 并行调用两个 API ──
    const statusP = post(
      `${baseUrl}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
      { metadata: meta },
      headers
    );
    const rateLimitP = model
      ? post(
          `${baseUrl}/exa.api_server_pb.ApiServerService/CheckUserMessageRateLimit`,
          { metadata: meta, modelUid: rateLimitUid },
          headers
        ).catch(() => null)
      : Promise.resolve(null);

    const [r, rl] = await Promise.all([statusP, rateLimitP]);
    const raw = r.body.slice(0, 800);

    if (r.status === 401) return { ok: false, reason: `${tag}Key 已失效 (401)`, status: r.status, raw };
    if (r.status === 403) return { ok: false, reason: `${tag}账号封禁 (403)`, status: r.status, raw };
    if (r.status !== 200) return { ok: false, reason: `${tag}异常响应 (${r.status})`, status: r.status, raw };

    let d: any = {};
    try { d = JSON.parse(r.body); } catch { return { ok: false, reason: `${tag}响应解析失败`, status: r.status, raw }; }

    // ── 解析 CheckRateLimit 结果 ──
    let hasCapacity = true;
    let remaining: number | null = null;
    let rateLimitReason = '';
    if (rl && rl.status === 200) {
      const parsed = parseRateLimitBody(rl.body);
      hasCapacity = parsed.ok;
      rateLimitReason = parsed.reason || '';
      if (typeof parsed.remaining === 'number' && parsed.remaining >= 0) {
        remaining = parsed.remaining;
      }
    }

    // ── 基础账号信息 ──
    const tier: string = d.userStatus?.teamsTier || d.planInfo?.teamsTier || '';
    const planName: string = d.planInfo?.planName || d.userStatus?.planStatus?.planInfo?.planName || '';
    const ps = d.userStatus?.planStatus;

    // 到期 / 宽限期检测
    if (ps) {
      const grace = ps.gracePeriodStatus;
      if (grace && grace !== 0 && grace !== 'GRACE_PERIOD_STATUS_UNSPECIFIED') {
        return { ok: false, reason: `${tag}宽限期受限 (grace=${grace})`, status: r.status, raw };
      }
      const planEndSec: number | undefined = ps.planEnd?.seconds ?? ps.planEnd;
      if (planEndSec && Number(planEndSec) > 0 && Number(planEndSec) * 1000 < Date.now()) {
        const dd = new Date(Number(planEndSec) * 1000).toLocaleDateString('zh-CN');
        return { ok: false, reason: `${tag}会员已到期 (${dd})`, status: r.status, raw };
      }
    }

    const daily = ps ? Number(ps.dailyQuotaRemainingPercent ?? 100) : -1;
    const weekly = ps ? Number(ps.weeklyQuotaRemainingPercent ?? 100) : -1;
    const quotaStr = daily >= 0 ? ` 日${daily}% 周${weekly}%` : '';

    // ── 无模型选择：仅检测账号状态 ──
    if (!model) {
      return { ok: true, reason: `正常 [${planName || tier}]${quotaStr}`, status: r.status, raw };
    }

    // ── 限速检测（优先：消息数为 0 直接判不可用） ──
    if (!hasCapacity) {
      return { ok: false, reason: `${tag}限速 [${planName}] ${rateLimitReason || '消息已用尽'}`, status: r.status, raw };
    }
    if (remaining === 0) {
      return { ok: false, reason: `${tag}限速 [${planName}] 剩余 0 条`, status: r.status, raw };
    }

    // 剩余消息标签
    const remainStr = remaining !== null ? ` 剩余${remaining}条` : '';

    // ── 模型权限检测 ──
    const allowedCfg: any[] =
      d.planInfo?.cascadeAllowedModelsConfig
      || d.userStatus?.planStatus?.planInfo?.cascadeAllowedModelsConfig
      || [];

    const allowedSet = new Set<string>();
    for (const entry of allowedCfg) {
      const m = entry?.modelOrAlias?.model;
      if (m) allowedSet.add(m);
    }

    const protoName = UID_PROTO_MAP[model.uid] || model.uid;
    const isProtoModel = protoName.startsWith('MODEL_');

    // ── 模型权限判定 ──
    // SWE / CODEMAP 等基础设施模型可能不在 allowedModels 中，但实际可用（额度没了也能用）
    const isFreeModel = /^MODEL_(SWE|CODEMAP|COGNITION)/i.test(protoName) || /^swe-/i.test(model.uid);
    let cloudOk = false;
    let cloudReason = '';
    if (isProtoModel) {
      if (allowedSet.has(protoName) || isFreeModel) {
        cloudOk = true;
        cloudReason = `${tag}可用 [${planName}]${remainStr}${quotaStr}`;
      } else {
        return { ok: false, reason: `${tag}无权限 [${planName}] 该账号等级不支持此模型`, status: r.status, raw };
      }
    } else {
      // UID-only 模型（如 claude-sonnet-4-6）
      const tierLower = tier.toLowerCase();
      const isTrial = tierLower.includes('trial');
      const isPro = tierLower.includes('pro') || tierLower.includes('enterprise');
      if (isTrial || isPro) {
        cloudOk = true;
        cloudReason = `${tag}可用 [${planName}]${remainStr}${quotaStr}`;
      } else {
        return { ok: false, reason: `${tag}无权限 [${planName}] Free 账号不支持此模型`, status: r.status, raw };
      }
    }

    // ── Cascade Canary Probe：隔离 LS 测真实 overall message rate limit ──
    if (cloudOk && _cascadeProbeEnabled) {
      if (signal?.aborted) return { ok: false, reason: '已取消' };
      const probe = await cascadeProbe(account.apiKey, rateLimitUid || protoName, true, probeMessage || _cascadeProbeMessage, lsInfo);
      if (probe.rateLimited) {
        return { ok: false, reason: formatProbeLimitReason(tag, planName, probe), status: r.status, raw };
      }
      if (probe.reply) {
        cloudReason += ` 回复: ${probe.reply}`;
      }
      if (probe.error) {
        return { ok: false, reason: `${tag}探针失败 [probe: ${probe.error}]`, status: r.status, raw };
      }
    }

    return { ok: cloudOk, reason: cloudReason, status: r.status, raw };
  } catch (err: any) {
    return { ok: false, reason: `${tag}请求失败: ${err?.message || err}` };
  }
}

/**
 * 获取配额数据（GetUserStatus）
 */
export interface FetchUsageOptions {
  previousSnapshot?: UsageSnapshot | null;
  fetchPeriod?: boolean;
}

export async function fetchUsage(account: StoredAccount, options: FetchUsageOptions = {}): Promise<{ snapshot: UsageSnapshot | null; error?: string }> {
  if (!account.apiKey) {
    return { snapshot: null, error: '缺少 apiKey，请使用命令面板 "Kite: 修复缺失凭据" 或重新导入账号' };
  }
  try {
    const baseUrl = (account.apiServerUrl || 'https://server.codeium.com').replace(/\/$/, '');
    const res = await post(
      `${baseUrl}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
      {
        metadata: {
          apiKey: account.apiKey,
          ideName: 'windsurf',
          ideVersion: '0.0.0',
          extensionName: 'windsurf-next',
          extensionVersion: '1.0.0',
          locale: 'en'
        }
      },
      {
        'Connect-Protocol-Version': '1',
        'Accept': 'application/json'
      }
    );

    if (res.status !== 200) {
      return { snapshot: null, error: `HTTP ${res.status}` };
    }

    const data = JSON.parse(res.body);
    const ps = data?.userStatus?.planStatus;

    if (!ps) {
      return { snapshot: null, error: '无 planStatus 数据' };
    }

    // 会员期限接口较慢。大批量刷新时默认复用旧值，单账号/首次刷新再补齐。
    const shouldFetchPeriod = options.fetchPeriod !== false || !options.previousSnapshot?.planEnd;
    const period = shouldFetchPeriod
      ? await fetchPlanPeriod(account)
      : { start: options.previousSnapshot?.planStart, end: options.previousSnapshot?.planEnd };

    // 提取 orgId：优先用 account 上已有的，其次从 teamId 解析
    let orgId = account.orgId || '';
    if (!orgId) {
      const teamId: string = data?.userStatus?.teamId || '';
      if (teamId.includes('$')) {
        orgId = teamId.split('$').pop() || '';
      }
    }

    // overageBalanceMicros 可能是字符串或数字，统一转换
    const parseBalance = (v: any): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') return parseInt(v, 10) || 0;
      return 0;
    };
    const overageBalanceMicros = parseBalance(period.overageBalanceMicros) || parseBalance(ps.overageBalanceMicros);

    const snapshot: UsageSnapshot = {
      name: account.name || account.email.split('@')[0],
      email: account.email,
      planName: ps.planInfo?.planName || 'Unknown',
      dailyRemainingPercent: Math.max(0, Math.min(100, Number(ps.dailyQuotaRemainingPercent) || 0)),
      weeklyRemainingPercent: Math.max(0, Math.min(100, Number(ps.weeklyQuotaRemainingPercent) || 0)),
      dailyResetAtUnix: parseInt(String(ps.dailyQuotaResetAtUnix)) || 0,
      weeklyResetAtUnix: parseInt(String(ps.weeklyQuotaResetAtUnix)) || 0,
      flexCredits: parseInt(String(ps.availableFlexCredits)) || 0,
      overageBalanceMicros,
      planStart: period.start,
      planEnd: period.end,
      orgId,
      _rawPlanStatus: ps
    };

    return { snapshot };
  } catch (err) {
    return { snapshot: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 获取会员期限（GetPlanStatus）
 */
async function fetchPlanPeriod(account: StoredAccount): Promise<{ start?: string; end?: string; overageBalanceMicros?: number }> {
  try {
    const res = await post(
      'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus',
      { includeTopUpStatus: true },
      {
        'Accept': 'application/json',
        'Connect-Protocol-Version': '1',
        'x-auth-token': account.apiKey,
        'x-devin-session-token': account.apiKey
      }
    );

    if (res.status !== 200) {
      return {};
    }

    const data = JSON.parse(res.body);
    const ps = data?.planStatus || data;
    // topUpStatus 包含额外余额信息
    const topUp = data?.topUpStatus || {};

    return {
      start: ps.planStart,
      end: ps.planEnd,
      // 优先从 topUpStatus 获取，其次从 planStatus 获取
      overageBalanceMicros: topUp.overageBalanceMicros ?? topUp.balanceMicros ?? ps.overageBalanceMicros
    };
  } catch {
    return {};
  }
}
