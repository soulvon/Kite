import { LoginResult } from './types';
import { post } from './httpClient';
import { FIREBASE_API_KEY } from './config';
import { getIdeDisplayName } from './ideDetector';

/** 安全解析 JSON，失败返回 null（避免 502 HTML 错误页抛 Unexpected token） */
function safeJsonParse<T = any>(s: string): T | null {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * 检测认证方式
 */
async function detectAuthMethod(email: string): Promise<{ method: 'auth1' | 'firebase'; hasPassword: boolean | null }> {
  try {
    const det = await post('https://windsurf.com/_devin-auth/connections', { product: 'windsurf', email });
    if (det.status === 200) {
      const dd = safeJsonParse(det.body);
      if (dd) {
        const method = (dd.auth_method?.method || 'firebase').toLowerCase();
        const hasPassword = dd.auth_method?.has_password ?? null;
        return { method: method as 'auth1' | 'firebase', hasPassword };
      }
    }
  } catch {
    // 忽略错误，默认使用 firebase
  }
  return { method: 'firebase', hasPassword: null };
}

/**
 * Auth1 登录流程
 */
async function loginAuth1(email: string, password: string): Promise<LoginResult> {
  // 步骤 1: 密码登录
  const lr = await post('https://windsurf.com/_devin-auth/password/login', { email, password });
  if (lr.status === 401 || lr.status === 403) {
    return { ok: false, error: '邮箱或密码错误' };
  }
  if (lr.status !== 200) {
    return { ok: false, error: `Auth1登录失败:HTTP${lr.status}` };
  }

  const loginResult = safeJsonParse(lr.body);
  if (!loginResult) return { ok: false, error: 'Auth1 响应不是 JSON（服务器可能不可用）' };
  const auth1Token = loginResult.token;
  const userId = loginResult.user_id || '';

  if (!auth1Token) {
    return { ok: false, error: 'Auth1响应缺少token' };
  }

  // 步骤 2: PostAuth 获取 sessionToken
  const pa = await post(
    'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth',
    {},
    {
      Accept: 'application/json',
      'Connect-Protocol-Version': '1',
      'X-Devin-Auth1-Token': auth1Token,
      'X-Devin-Account-Id': userId
    }
  );

  if (pa.status !== 200) {
    const em = safeJsonParse(pa.body)?.message || '';
    return { ok: false, error: `PostAuth失败:${pa.status}${em ? ' ' + em : ''}` };
  }

  const pd = safeJsonParse(pa.body);
  if (!pd) return { ok: false, error: 'PostAuth 响应不是 JSON' };
  const sessionToken = pd.sessionToken || pd.session_token;

  if (!sessionToken) {
    return { ok: false, error: 'PostAuth未返回sessionToken' };
  }

  return {
    ok: true,
    value: {
      email,
      apiKey: sessionToken,
      apiServerUrl: 'https://server.self-serve.windsurf.com',
      name: email.split('@')[0],
      devinAuth1Token: auth1Token,
    }
  };
}

/**
 * Firebase 登录流程
 */
async function loginFirebase(email: string, password: string): Promise<LoginResult> {
  // 步骤 1: Firebase signInWithPassword
  const fr = await post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    { email, password, returnSecureToken: true, clientType: 'CLIENT_TYPE_WEB' },
    { Accept: '*/*', Referer: 'https://windsurf.com/' }
  );

  if (fr.status !== 200) {
    const errMsg = safeJsonParse(fr.body)?.error?.message || '';
    const errMap: Record<string, string> = {
      EMAIL_NOT_FOUND: '邮箱不存在',
      INVALID_PASSWORD: '密码错误',
      INVALID_LOGIN_CREDENTIALS: '邮箱或密码错误',
      USER_DISABLED: '账号已被禁用',
      TOO_MANY_ATTEMPTS_TRY_LATER: '尝试过多请稍后再试'
    };
    return { ok: false, error: errMap[errMsg] || `Firebase登录失败:${errMsg || 'HTTP' + fr.status}` };
  }

  const fbResp = safeJsonParse(fr.body);
  if (!fbResp) return { ok: false, error: 'Firebase 响应不是 JSON' };
  const idToken = fbResp.idToken;
  if (!idToken) {
    return { ok: false, error: 'Firebase响应缺少idToken' };
  }

  // 步骤 2: RegisterUser 获取 apiKey
  const rr = await post(
    'https://register.windsurf.com/exa.api_server_pb.ApiServerService/RegisterUser',
    { firebase_id_token: idToken },
    { Accept: 'application/json', 'connect-protocol-version': '1' }
  );

  if (rr.status !== 200) {
    return { ok: false, error: `RegisterUser失败:HTTP${rr.status}` };
  }

  const rd = safeJsonParse(rr.body);
  if (!rd) return { ok: false, error: 'RegisterUser 响应不是 JSON' };
  const apiKey = rd.api_key || rd.apiKey;
  if (!apiKey) {
    return { ok: false, error: 'RegisterUser响应缺少api_key' };
  }

  return {
    ok: true,
    value: {
      email,
      apiKey,
      apiServerUrl: rd.api_server_url || rd.apiServerUrl || 'https://server.codeium.com',
      name: rd.name || email.split('@')[0]
    }
  };
}

/**
 * 从 session token 中提取 session_id 的短后缀，用于区分同一用户的不同 org token。
 * JWT 格式: devin-session-token$header.payload.signature
 * payload 解码后: {"session_id":"windsurf-session-<uuid>"}
 * 返回 uuid 的最后 4 位十六进制，例如 "cde4"
 */
function extractSessionSuffix(token: string): string {
  try {
    const jwt = token.startsWith('devin-session-token$') ? token.substring(20) : token;
    const parts = jwt.split('.');
    if (parts.length < 2) return '';
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const obj = JSON.parse(payload);
    const sid: string = obj?.session_id || '';
    if (sid.length >= 4) return sid.slice(-4);
  } catch { /* ignore decode errors */ }
  return '';
}

/**
 * 通过 devin session token 直接导入（已是最终 session token，无需 PostAuth）
 */
async function loginBySessionToken(sessionToken: string): Promise<LoginResult> {
  sessionToken = sessionToken.trim();
  if (!sessionToken) {
    return { ok: false, error: '空 session token' };
  }
  if (sessionToken.startsWith('eyJ')) {
    sessionToken = 'devin-session-token$' + sessionToken;
  }

  try {
    // 用 sessionToken 查询邮箱（GetUserStatus）
    const ur = await post(
      'https://server.self-serve.windsurf.com/exa.seat_management_pb.SeatManagementService/GetUserStatus',
      {
        metadata: {
          apiKey: sessionToken,
          ideName: 'windsurf',
          ideVersion: '0.0.0',
          extensionName: 'windsurf-next',
          extensionVersion: '1.0.0',
          locale: 'en'
        }
      },
      { 'Connect-Protocol-Version': '1', Accept: 'application/json' }
    );

    if (ur.status === 401) {
      return { ok: false, error: `Session Token 已失效或不适用于 ${getIdeDisplayName()} API (401)` };
    }
    if (ur.status === 403) {
      return { ok: false, error: 'Session Token 无权限或账号受限 (403)' };
    }
    if (ur.status !== 200) {
      return { ok: false, error: `Session Token 校验失败:HTTP${ur.status}` };
    }

    const ud = safeJsonParse(ur.body);
    if (!ud?.userStatus) {
      return { ok: false, error: 'Session Token 校验响应缺少 userStatus' };
    }

    let email = '';
    let name = '';
    email = ud.userStatus.email || ud.userStatus.userName || '';
    name = ud.userStatus.name || ud.userStatus.userName || '';

    if (!email) {
      email = 'session_' + sessionToken.substring(0, 12) + '...';
    }

    // 提取 orgId：优先从 teamId 中提取 account UUID
    const teamId: string = ud.userStatus.teamId || '';
    let orgId = '';
    if (teamId.includes('$')) {
      orgId = teamId.split('$').pop() || '';
    }

    // 为同一用户的不同 org token 生成唯一 email，避免 upsert 时互相覆盖
    const suffix = extractSessionSuffix(sessionToken);
    if (suffix) {
      email = email + ' [' + suffix + ']';
    }

    return {
      ok: true,
      value: {
        email,
        apiKey: sessionToken,
        apiServerUrl: 'https://server.self-serve.windsurf.com',
        name: name || email.split('@')[0],
        orgId
      }
    };
  } catch (err) {
    return { ok: false, error: 'Session Token导入出错:' + (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * 通过 auth1 token 直接导入账号（无需邮箱密码）
 */
export async function loginByAuth1Token(auth1Token: string): Promise<LoginResult> {
  auth1Token = auth1Token.trim();
  if (!auth1Token) {
    return { ok: false, error: '空 token' };
  }

  // devin-session-token$ 前缀 → 已经是 session token，跳过 PostAuth 直接入库
  const SESSION_PREFIX = 'devin-session-token$';
  if (auth1Token.startsWith(SESSION_PREFIX)) {
    return loginBySessionToken(auth1Token);
  }

  try {
    // 步骤 1: PostAuth 获取 sessionToken
    const pa = await post(
      'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth',
      {},
      {
        Accept: 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Devin-Auth1-Token': auth1Token,
      }
    );

    if (pa.status !== 200) {
      const em = safeJsonParse(pa.body)?.message || '';
      return { ok: false, error: `PostAuth失败:${pa.status}${em ? ' ' + em : ''}` };
    }

    const pd = safeJsonParse(pa.body);
    if (!pd) return { ok: false, error: 'PostAuth 响应不是 JSON' };
    const sessionToken = pd.sessionToken || pd.session_token;

    if (!sessionToken) {
      return { ok: false, error: 'PostAuth未返回sessionToken' };
    }

    // 步骤 2: 用 sessionToken 查询邮箱（GetUserStatus）
    const ur = await post(
      'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus',
      {
        metadata: {
          apiKey: sessionToken,
          ideName: 'windsurf',
          ideVersion: '0.0.0',
          extensionName: 'windsurf-next',
          extensionVersion: '1.0.0',
          locale: 'en'
        }
      },
      { 'Connect-Protocol-Version': '1', Accept: 'application/json' }
    );

    let email = '';
    let name = '';
    if (ur.status === 200) {
      const ud = safeJsonParse(ur.body);
      email = ud?.userStatus?.email || ud?.userStatus?.userName || '';
      name = ud?.userStatus?.name || ud?.userStatus?.userName || '';
    }

    if (!email) {
      // 邮箱拿不到，用 token 前缀做标识
      email = 'auth1_' + auth1Token.substring(0, 12) + '...';
    }

    return {
      ok: true,
      value: {
        email,
        apiKey: sessionToken,
        apiServerUrl: 'https://server.self-serve.windsurf.com',
        name: name || email.split('@')[0],
        devinAuth1Token: auth1Token,
      }
    };
  } catch (err) {
    return { ok: false, error: 'Token导入出错:' + (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * 登录主函数（自动检测认证方式）
 */
export async function login(email: string, password: string, authMethod: 'auto' | 'auth1' | 'firebase' = 'auto'): Promise<LoginResult> {
  if (!email || !password) {
    return { ok: false, error: '请输入邮箱和密码。' };
  }

  email = email.trim();

  try {
    if (authMethod === 'auth1') {
      return await loginAuth1(email, password);
    } else if (authMethod === 'firebase') {
      return await loginFirebase(email, password);
    }

    // 自动检测认证方式
    const { method, hasPassword } = await detectAuthMethod(email);

    if (method === 'auth1') {
      if (hasPassword === false) {
        return { ok: false, error: '该账号未开启密码登录（可能是 Google/SSO 账号），请先设置密码' };
      }
      return await loginAuth1(email, password);
    } else {
      return await loginFirebase(email, password);
    }
  } catch (err) {
    return { ok: false, error: '登录出错:' + (err instanceof Error ? err.message : String(err)) };
  }
}
