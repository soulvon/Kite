import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';
import { StoredAccount } from './types';
import { post } from './httpClient';
import { getIdeDisplayName } from './ideDetector';

const WINDSURF_AUTH_BASE_URL = 'https://www.windsurf.com';
const WINDSURF_REGISTER_API_BASE_URL = 'https://register.windsurf.com';
const WINDSURF_DEFAULT_API_SERVER_URL = 'https://server.codeium.com';
const WINDSURF_CLIENT_ID = '3GUryQ7ldAeKEuD2obYnppsnmj58eP5u';
const OAUTH_TIMEOUT_MS = 10 * 60 * 1000;

function randomToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function safeJsonParse<T = any>(s: string): T | null {
  try { return JSON.parse(s); } catch { return null; }
}

function pickString(obj: any, keys: string[]): string {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams();
  params.set('response_type', 'token');
  params.set('client_id', WINDSURF_CLIENT_ID);
  params.set('redirect_uri', redirectUri);
  params.set('state', state);
  params.set('prompt', 'login');
  params.set('redirect_parameters_type', 'query');
  params.set('workflow', 'onboarding');
  return `${WINDSURF_AUTH_BASE_URL}/windsurf/signin?${params.toString()}`;
}

function successHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${getIdeDisplayName()} 授权成功</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}.box{max-width:460px;padding:24px;border-radius:12px;background:#111827;border:1px solid #1f2937;text-align:center}h1{color:#22c55e;margin:0 0 10px;font-size:24px}p{margin:0;opacity:.9}</style></head>
<body><div class="box"><h1>授权成功</h1><p>可以关闭此页面，返回 ${getIdeDisplayName()} 号池管理。</p></div></body></html>`;
}

function failHtml(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${getIdeDisplayName()} 授权失败</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}.box{max-width:520px;padding:24px;border-radius:12px;background:#111827;border:1px solid #1f2937;text-align:center}h1{color:#ef4444;margin:0 0 10px;font-size:24px}p{margin:0;opacity:.9;word-break:break-word}</style></head>
<body><div class="box"><h1>授权失败</h1><p>${message.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch))}</p></div></body></html>`;
}

function createOAuthCallbackServer(): Promise<{ authUrl: string; tokenPromise: Promise<string>; close(): void }> {
  return new Promise((resolve, reject) => {
    const state = randomToken();
    let server: http.Server | null = null;
    let timer: NodeJS.Timeout | null = null;
    let tokenResolve: ((token: string) => void) | null = null;
    let tokenReject: ((err: Error) => void) | null = null;
    const tokenPromise = new Promise<string>((res, rej) => {
      tokenResolve = res;
      tokenReject = rej;
    });

    const close = () => {
      if (timer) clearTimeout(timer);
      try { server?.close(); } catch {}
    };

    const finish = (err?: Error, accessToken?: string) => {
      close();
      if (err) {
        tokenReject?.(err);
      } else {
        tokenResolve?.(accessToken || '');
      }
    };

    server = http.createServer((req, res) => {
      const host = req.headers.host || '127.0.0.1';
      const url = new URL(req.url || '/', `http://${host}`);
      if (url.pathname !== '/windsurf-auth-callback') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const gotState = url.searchParams.get('state') || '';
      const error = url.searchParams.get('error') || '';
      const errorDescription = url.searchParams.get('error_description') || '';
      const accessToken = url.searchParams.get('access_token') || '';

      if (gotState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(failHtml('state 校验失败，请重新授权。'));
        finish(new Error('OAuth state 校验失败'));
        return;
      }

      if (error) {
        const message = errorDescription ? `${error} (${errorDescription})` : error;
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(failHtml(message));
        finish(new Error(`授权失败: ${message}`));
        return;
      }

      if (!accessToken.trim()) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(failHtml('回调缺少 access_token，请重新授权。'));
        finish(new Error('回调缺少 access_token'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(successHtml());
      finish(undefined, accessToken);
    });

    server.on('error', err => finish(err instanceof Error ? err : new Error(String(err))));
    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('读取本地 OAuth 回调端口失败'));
        return;
      }
      const callbackUrl = `http://127.0.0.1:${addr.port}/windsurf-auth-callback`;
      const authUrl = buildAuthUrl(callbackUrl, state);
      timer = setTimeout(() => finish(new Error(`等待 ${getIdeDisplayName()} OAuth 授权超时`)), OAUTH_TIMEOUT_MS);
      resolve({ authUrl, tokenPromise, close });
    });
  });
}

async function exchangeFirebaseToken(firebaseIdToken: string): Promise<StoredAccount> {
  const register = await post(
    `${WINDSURF_REGISTER_API_BASE_URL}/exa.seat_management_pb.SeatManagementService/RegisterUser`,
    { firebase_id_token: firebaseIdToken },
    { Accept: 'application/json', 'Connect-Protocol-Version': '1' }
  );

  if (register.status !== 200) {
    const msg = safeJsonParse(register.body)?.message || register.body.slice(0, 160);
    throw new Error(`RegisterUser 失败: HTTP ${register.status}${msg ? ' ' + msg : ''}`);
  }

  const rd = safeJsonParse(register.body);
  const apiKey = pickString(rd, ['apiKey', 'api_key']);
  const apiServerUrl = pickString(rd, ['apiServerUrl', 'api_server_url']) || WINDSURF_DEFAULT_API_SERVER_URL;
  const registerName = pickString(rd, ['name']);
  if (!apiKey) throw new Error('RegisterUser 响应缺少 apiKey');

  let currentUser: any = null;
  let authToken = '';
  try {
    const oneTime = await post(
      `${apiServerUrl.replace(/\/$/, '')}/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken`,
      { firebaseIdToken: firebaseIdToken },
      { Accept: 'application/json', 'Connect-Protocol-Version': '1' }
    );
    if (oneTime.status === 200) {
      const od = safeJsonParse(oneTime.body);
      authToken = pickString(od, ['authToken', 'auth_token']);
    }
  } catch {
    // Optional: GetUserStatus below is enough for most accounts.
  }

  if (authToken) {
    try {
      const current = await post(
        `${apiServerUrl.replace(/\/$/, '')}/exa.seat_management_pb.SeatManagementService/GetCurrentUser`,
        { authToken, includeSubscription: true },
        { Accept: 'application/json', 'Connect-Protocol-Version': '1' }
      );
      if (current.status === 200) {
        currentUser = safeJsonParse(current.body)?.user || null;
      }
    } catch {
      // Optional snapshot only.
    }
  }

  const status = await post(
    `${apiServerUrl.replace(/\/$/, '')}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
    {
      metadata: {
        apiKey,
        ideName: 'Windsurf',
        ideVersion: '1.0.0',
        extensionName: 'codeium.windsurf',
        extensionVersion: '1.0.0',
        locale: 'zh-CN',
        os: process.platform === 'darwin' ? 'darwin' : process.platform,
        disableTelemetry: false,
        sessionId: `kite-${Date.now()}`,
        requestId: String(Date.now()),
      }
    },
    { Accept: 'application/json', 'Connect-Protocol-Version': '1' }
  );

  let email = '';
  let name = registerName;
  if (currentUser) {
    email = pickString(currentUser, ['email']);
    name = pickString(currentUser, ['name', 'username']) || name;
  }
  if (status.status === 200) {
    const sd = safeJsonParse(status.body);
    const user = sd?.userStatus || {};
    email = email || pickString(user, ['email', 'userName', 'username']);
    name = name || pickString(user, ['name', 'userName', 'username']);
  }

  if (!email) {
    throw new Error(`OAuth 已换取 apiKey，但 GetUserStatus 未返回邮箱 (HTTP ${status.status})`);
  }

  return {
    email,
    apiKey,
    apiServerUrl,
    name: name || email.split('@')[0],
  };
}

export async function loginByWindsurfOAuth(): Promise<StoredAccount> {
  const state = await createOAuthCallbackServer();
  try {
    await vscode.env.openExternal(vscode.Uri.parse(state.authUrl));
    const accessToken = await state.tokenPromise;
    if (!accessToken) throw new Error('OAuth 回调未返回 access_token');
    return exchangeFirebaseToken(accessToken);
  } finally {
    state.close();
  }
}
