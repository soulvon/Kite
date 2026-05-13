import { StoredAccount, UsageSnapshot } from './types';
import { post } from './httpClient';

/**
 * 检测账号是否正常
 * 策略1：CheckUserMessageRateLimit（直接检测 overall message rate limit）
 * 策略2（fallback）：GetUserStatus 检查 planEnd / gracePeriodStatus
 */
export async function testModelAccess(account: StoredAccount): Promise<{ ok: boolean; reason?: string; status?: number; raw?: string }> {
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

  // ── 策略1：CheckUserMessageRateLimit ──────────────────────────────
  try {
    const r1 = await post(
      `${baseUrl}/exa.language_server_pb.LanguageServerService/CheckUserMessageRateLimit`,
      { metadata: meta, modelUid: '' },
      headers
    );
    const raw1 = r1.body.slice(0, 800);

    if (r1.status === 401) return { ok: false, reason: 'Key 已失效 (401)', status: r1.status, raw: raw1 };
    if (r1.status === 403) return { ok: false, reason: '账号封禁 (403)', status: r1.status, raw: raw1 };

    if (r1.status === 200) {
      let d: any = {};
      try { d = JSON.parse(r1.body); } catch { /* ignore */ }
      const hasCapacity: boolean = d?.hasCapacity !== false; // 默认 true（proto3 bool 默认值 false 不序列化）
      if (!hasCapacity) {
        const msg: string = d?.message || 'Reached overall message rate limit';
        const remain: number = d?.messagesRemaining ?? 0;
        return { ok: false, reason: `消息限速: ${msg} (剩余${remain})`, status: r1.status, raw: raw1 };
      }
      const remain: number = d?.messagesRemaining ?? '?';
      return { ok: true, reason: `正常 (剩余消息 ${remain})`, status: r1.status, raw: raw1 };
    }
    // 非 200/401/403 → 可能端点不支持直接调用，走 fallback
  } catch { /* fallback */ }

  // ── 策略2 fallback：GetUserStatus ────────────────────────────────
  try {
    const r2 = await post(
      `${baseUrl}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
      { metadata: meta },
      headers
    );
    const raw2 = r2.body.slice(0, 800);

    if (r2.status === 401) return { ok: false, reason: 'Key 已失效 (401)', status: r2.status, raw: raw2 };
    if (r2.status === 403) return { ok: false, reason: '账号封禁 (403)', status: r2.status, raw: raw2 };
    if (r2.status !== 200) return { ok: false, reason: `异常响应 (${r2.status})`, status: r2.status, raw: raw2 };

    let d2: any = {};
    try { d2 = JSON.parse(r2.body); } catch { return { ok: false, reason: '响应解析失败', status: r2.status, raw: raw2 }; }

    const ps = d2?.userStatus?.planStatus;
    if (!ps) return { ok: false, reason: '无 planStatus', status: r2.status, raw: raw2 };

    const grace = ps.gracePeriodStatus;
    if (grace && grace !== 0 && grace !== 'GRACE_PERIOD_STATUS_UNSPECIFIED') {
      return { ok: false, reason: `宽限期受限 (grace=${grace})`, status: r2.status, raw: raw2 };
    }

    const planEndSec: number | undefined = ps.planEnd?.seconds ?? ps.planEnd;
    if (planEndSec && Number(planEndSec) > 0 && Number(planEndSec) * 1000 < Date.now()) {
      const d = new Date(Number(planEndSec) * 1000).toLocaleDateString('zh-CN');
      return { ok: false, reason: `会员已到期 (${d})`, status: r2.status, raw: raw2 };
    }

    const daily = Number(ps.dailyQuotaRemainingPercent ?? 100);
    const weekly = Number(ps.weeklyQuotaRemainingPercent ?? 100);
    return { ok: true, reason: `fallback正常 (日${daily}% 周${weekly}%)`, status: r2.status, raw: raw2 };
  } catch (err: any) {
    return { ok: false, reason: `请求失败: ${err?.message || err}` };
  }
}

/**
 * 获取配额数据（GetUserStatus）
 */
export async function fetchUsage(account: StoredAccount): Promise<{ snapshot: UsageSnapshot | null; error?: string }> {
  try {
    const res = await post(
      'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus',
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

    // 同时获取会员期限
    const period = await fetchPlanPeriod(account);

    const snapshot: UsageSnapshot = {
      name: account.name || account.email.split('@')[0],
      email: account.email,
      planName: ps.planInfo?.planName || 'Unknown',
      dailyRemainingPercent: Math.max(0, Math.min(100, Number(ps.dailyQuotaRemainingPercent) || 0)),
      weeklyRemainingPercent: Math.max(0, Math.min(100, Number(ps.weeklyQuotaRemainingPercent) || 0)),
      dailyResetAtUnix: parseInt(String(ps.dailyQuotaResetAtUnix)) || 0,
      weeklyResetAtUnix: parseInt(String(ps.weeklyQuotaResetAtUnix)) || 0,
      flexCredits: parseInt(String(ps.availableFlexCredits)) || 0,
      overageBalanceMicros: typeof ps.overageBalanceMicros === 'number' ? ps.overageBalanceMicros : 0,
      planStart: period.start,
      planEnd: period.end,
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
async function fetchPlanPeriod(account: StoredAccount): Promise<{ start?: string; end?: string }> {
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

    return {
      start: ps.planStart,
      end: ps.planEnd
    };
  } catch {
    return {};
  }
}
