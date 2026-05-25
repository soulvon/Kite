"""
Devin 一键领 $200 - 纯 API 版本（无浏览器）

原理：
1. 用 auth1 token 或 邮箱密码 登录
2. 解析 org_id
3. 检查是否已领（automationsGranted / overage_credits）
4. 跳过 GitHub onboarding（PUT /api/users/info）
5. 创建 Automation（POST /api/{org}/automations）→ 触发 $200

用法：
  python devin_claim_200_api.py                    # 处理所有账号
  python devin_claim_200_api.py --query-only       # 只查询不领取
  python devin_claim_200_api.py --email xxx --pwd yyy  # 单个账号
"""
import json
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Tuple, Dict, Any

# ============ 配置 ============
DEVIN_AUTH_URL = "https://windsurf.com/_devin-auth"
DEVIN_APP_URL = "https://app.devin.ai"
CREDITS_THRESHOLD = 5.0  # 余额 > $5 跳过
CONCURRENCY = 6

# ============ 账号列表（填入你的账号）============
ACCOUNTS = [
    # 格式：("email", "password") 或 ("auth1_xxx_token",)
    # ("example@gmail.com", "password123"),
    # ("auth1_xxxxxxx",),
]


def _post_json(url: str, body: dict = None, headers: dict = None, method: str = "POST") -> dict:
    """HTTP JSON 请求"""
    data = json.dumps(body).encode("utf-8") if body else None
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return {"status": resp.status, "body": json.loads(resp.read().decode("utf-8"))}
    except urllib.error.HTTPError as e:
        try:
            body_text = e.read().decode("utf-8", errors="replace")
            body_json = json.loads(body_text) if body_text.strip().startswith("{") else body_text
        except:
            body_json = str(e)
        return {"status": e.code, "body": body_json}
    except Exception as e:
        return {"status": 0, "body": str(e)}


def _get_json(url: str, headers: dict = None) -> dict:
    """HTTP GET JSON"""
    return _post_json(url, body=None, headers=headers, method="GET")


def login_devin(email: str, password: str) -> Optional[Dict[str, str]]:
    """
    登录 Devin，返回 {session_token, auth1_token, account_id, org_id} 或 None
    """
    # Step 1: 密码登录
    r = _post_json(f"{DEVIN_AUTH_URL}/password/login", {"email": email, "password": password})
    if r["status"] != 200:
        return None
    
    auth1_token = r["body"].get("token", "")
    user_id = r["body"].get("user_id", "")
    if not auth1_token:
        return None
    
    # Step 2: post-auth 换 session + org_id
    r2 = _post_json(
        f"{DEVIN_APP_URL}/api/users/post-auth",
        {},
        {"X-Devin-Auth1-Token": auth1_token, "X-Devin-Account-Id": user_id}
    )
    if r2["status"] != 200:
        return None
    
    body = r2["body"]
    session_token = body.get("session_token") or body.get("sessionToken", "")
    account_id = body.get("account_id") or body.get("accountId") or user_id
    org_id = body.get("org_id") or body.get("orgId") or body.get("primary_org_id", "")
    
    if not session_token or not org_id:
        return None
    
    return {
        "session_token": session_token,
        "auth1_token": auth1_token,
        "account_id": account_id,
        "org_id": org_id,
    }


def login_by_auth1_token(auth1_token: str) -> Optional[Dict[str, str]]:
    """用 auth1 token 直接换 session"""
    r = _post_json(
        f"{DEVIN_APP_URL}/api/users/post-auth",
        {},
        {"X-Devin-Auth1-Token": auth1_token}
    )
    if r["status"] != 200:
        return None
    
    body = r["body"]
    session_token = body.get("session_token") or body.get("sessionToken", "")
    account_id = body.get("account_id") or body.get("accountId", "")
    org_id = body.get("org_id") or body.get("orgId") or body.get("primary_org_id", "")
    
    if not session_token or not org_id:
        return None
    
    return {
        "session_token": session_token,
        "auth1_token": auth1_token,
        "account_id": account_id,
        "org_id": org_id,
    }


def get_auth_headers(creds: Dict[str, str]) -> dict:
    """构造 Devin API 请求头"""
    return {
        "X-Devin-Session-Token": creds["session_token"],
        "X-Devin-Account-Id": creds["account_id"],
        "X-Devin-Primary-Org-Id": creds["org_id"],
        "X-Devin-Auth1-Token": creds["auth1_token"],
        "Origin": DEVIN_APP_URL,
        "Referer": f"{DEVIN_APP_URL}/",
    }


def query_status(creds: Dict[str, str]) -> Dict[str, Any]:
    """
    查询账号状态：余额 + automationsGranted
    """
    headers = get_auth_headers(creds)
    org_id = creds["org_id"]
    
    # 并发请求三个端点
    results = {}
    
    # /api/{org}/billing/status
    r1 = _get_json(f"{DEVIN_APP_URL}/api/{org_id}/billing/status", headers)
    if r1["status"] == 200 and isinstance(r1["body"], dict):
        results["overage_credits"] = r1["body"].get("overage_credits") or r1["body"].get("overageCredits", 0)
        results["credit_balance"] = r1["body"].get("credit_balance") or r1["body"].get("creditBalance", 0)
    
    # /api/billing/checklist-credit-status
    r2 = _get_json(f"{DEVIN_APP_URL}/api/billing/checklist-credit-status", headers)
    if r2["status"] == 200 and isinstance(r2["body"], dict):
        granted = r2["body"].get("automations")
        results["automations_granted"] = granted in (True, "true", 1, "1")
    
    # /api/billing/subscription
    r3 = _get_json(f"{DEVIN_APP_URL}/api/billing/subscription", headers)
    if r3["status"] == 200 and isinstance(r3["body"], dict):
        results["subscription"] = r3["body"]
    
    return results


def skip_git_onboarding(creds: Dict[str, str]) -> bool:
    """跳过 GitHub onboarding"""
    headers = get_auth_headers(creds)
    r = _post_json(
        f"{DEVIN_APP_URL}/api/users/info",
        {"devin_onboarding_git_page": "skipped"},
        headers,
        method="PUT"
    )
    return r["status"] in (200, 201, 204)


def create_automation(creds: Dict[str, str]) -> Tuple[bool, str]:
    """
    创建 Automation → 触发 $200 奖励
    返回 (success, message)
    
    逆向自 wf-dialog-mcp 的完整 payload 格式
    """
    org_id = creds["org_id"]
    
    # 构造请求头（使用新格式）
    headers = {
        "Authorization": f"Bearer {creds['session_token']}",
        "x-cog-org-id": org_id,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": DEVIN_APP_URL,
        "Referer": f"{DEVIN_APP_URL}/",
    }
    
    # 生成时间戳名称
    ts = time.strftime("%Y%m%d_%H%M%S")
    prompt = "每天运行一次，检查项目状态并输出简短中文摘要。这是用于研究 Devin Automations 协议的测试表单内容。"
    
    # 完整 payload（逆向自 wf-dialog-mcp）
    payload = {
        "name": f"Daily Audit {ts}",
        "triggers": [{
            "event_type": "schedule:recurring",
            "conditions": [[{
                "field": "rrule",
                "operator": "matches",
                "value": "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0"  # 每天 UTC 9:00
            }]]
        }],
        "actions": [{
            "type": "start_session",
            "prompt": prompt,
            "rich_content": [{"text": prompt}]
        }],
        "enabled": True,
        "max_acu_limit": None,
        "invocation_limit": 50,
        "invocation_limit_window_seconds": 3600,
        "linear_tools_enabled": True,
        "net_policy": {
            "allow": [{"hostname": "git-manager.devin.ai"}]
        },
        "devin_mode": None
    }
    
    r = _post_json(f"{DEVIN_APP_URL}/api/{org_id}/automations", payload, headers)
    
    if r["status"] in (200, 201):
        body = r["body"] if isinstance(r["body"], dict) else {}
        auto_id = body.get("id") or body.get("automation_id", "unknown")
        return True, f"创建成功: {auto_id}"
    else:
        return False, f"HTTP {r['status']}: {r['body']}"


def process_account(account: Tuple) -> Dict[str, Any]:
    """处理单个账号"""
    result = {"account": account[0], "success": False, "message": "", "balance": 0}
    
    # 登录
    if len(account) == 1 and account[0].startswith("auth1_"):
        creds = login_by_auth1_token(account[0])
        result["account"] = account[0][:20] + "..."
    else:
        email, password = account
        creds = login_devin(email, password)
        result["account"] = email
    
    if not creds:
        result["message"] = "登录失败"
        return result
    
    # 查询状态
    status = query_status(creds)
    balance = status.get("overage_credits", 0)
    result["balance"] = balance
    
    # 已领取？
    if status.get("automations_granted"):
        result["message"] = f"已领取 (${balance})"
        result["success"] = True
        return result
    
    # 余额够高？
    if balance > CREDITS_THRESHOLD:
        result["message"] = f"余额已有 ${balance}，跳过"
        result["success"] = True
        return result
    
    # 跳过 GitHub onboarding
    if not skip_git_onboarding(creds):
        result["message"] = "跳过 GitHub 失败"
        return result
    
    # 创建 Automation
    time.sleep(0.5)  # 防止太快
    ok, msg = create_automation(creds)
    if ok:
        # 重新查询余额
        time.sleep(2)
        new_status = query_status(creds)
        new_balance = new_status.get("overage_credits", 0)
        result["success"] = True
        result["message"] = f"✅ ${balance} → ${new_balance}"
        result["balance"] = new_balance
    else:
        result["message"] = f"创建失败: {msg}"
    
    return result


def main():
    print("=" * 60)
    print("  Devin 一键领 $200 - 纯 API 版本")
    print("=" * 60)
    
    if not ACCOUNTS:
        print("\n❌ 请在 ACCOUNTS 列表中填入账号")
        print('   格式：("email", "password") 或 ("auth1_xxx",)')
        return
    
    query_only = "--query-only" in sys.argv
    
    print(f"\n共 {len(ACCOUNTS)} 个账号，并发 {CONCURRENCY}")
    if query_only:
        print("📋 仅查询模式，不领取\n")
    
    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = {executor.submit(process_account, acc): acc for acc in ACCOUNTS}
        for future in as_completed(futures):
            r = future.result()
            status = "✅" if r["success"] else "❌"
            print(f"  {status} {r['account']} → {r['message']}")
            results.append(r)
    
    # 汇总
    success = sum(1 for r in results if r["success"])
    failed = len(results) - success
    print(f"\n{'─' * 60}")
    print(f"完成: ✅ {success} / ❌ {failed} / 共 {len(results)}")


if __name__ == "__main__":
    main()
