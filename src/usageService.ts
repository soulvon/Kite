import { StoredAccount, UsageSnapshot } from './types';
import { post } from './httpClient';

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
