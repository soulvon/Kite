#!/usr/bin/env python3
"""
Devin AI 任务自动化脚本
支持三种模式:
1. windsurf-pool 模式 (--mode pool): 从 windsurf-pool 读取账号，批量完成任务
2. 协议模式 (--mode api): 使用已有 cookie 直接调用 API
3. 浏览器模式 (--mode browser): Playwright 自动化完成 OAuth 登录

用法:
    # 从 windsurf-pool 批量处理（推荐）
    python devin_automator.py --mode pool
    
    # 协议模式 - 需要提供 cookie
    python devin_automator.py --mode api --cookie "session=xxx"
    
    # 浏览器模式 - 自动打开浏览器登录
    python devin_automator.py --mode browser --github-user xxx --github-pass xxx
"""

import argparse
import json
import time
import sys
import os
from pathlib import Path
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

try:
    import requests
except ImportError:
    print("请安装 requests: pip install requests")
    sys.exit(1)


def get_windsurf_pool_accounts() -> List[Dict]:
    """从 windsurf-pool 读取账号列表"""
    if sys.platform == 'win32':
        appdata = os.environ.get('APPDATA', '')
        pool_file = Path(appdata) / '.windsurf-pool' / 'accounts.json'
    elif sys.platform == 'darwin':
        pool_file = Path.home() / 'Library' / 'Application Support' / '.windsurf-pool' / 'accounts.json'
    else:
        pool_file = Path.home() / '.config' / '.windsurf-pool' / 'accounts.json'
    
    if not pool_file.exists():
        print(f"[-] windsurf-pool 账号文件不存在: {pool_file}")
        return []
    
    try:
        with open(pool_file, 'r', encoding='utf-8') as f:
            accounts = json.load(f)
        print(f"[+] 读取到 {len(accounts)} 个账号")
        return accounts
    except Exception as e:
        print(f"[-] 读取账号文件失败: {e}")
        return []


def extract_devin_token(api_key: str) -> Optional[str]:
    """从 apiKey 提取 Devin session token"""
    if not api_key:
        return None
    # 格式: devin-session-token$eyJhbGciOi...
    if api_key.startswith('devin-session-token$'):
        return api_key  # 完整 token
    # 格式: auth1_xxx
    if api_key.startswith('auth1_'):
        return api_key
    return None


@dataclass
class DevinAccount:
    """Devin 账号信息"""
    github_user: Optional[str] = None
    github_pass: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    cookie: Optional[str] = None
    org_id: Optional[str] = None
    user_id: Optional[str] = None


class DevinAPI:
    """Devin API 协议层封装"""
    
    BASE_URL = "https://app.devin.ai"
    AUTH_URL = "https://server.self-serve.windsurf.com"  # Windsurf/Devin 共享认证服务
    
    def __init__(self, cookie: str = "", token: str = ""):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Origin": self.BASE_URL,
            "Referer": f"{self.BASE_URL}/",
        })
        if cookie:
            self.session.headers["Cookie"] = cookie
        
        self.token = token  # devin-session-token 或 auth1_xxx
        self.org_id: Optional[str] = None
        self.user_id: Optional[str] = None
        self.org_name: Optional[str] = None
        self.email: Optional[str] = None
    
    def login_by_token(self, token: str) -> bool:
        """使用 Windsurf/Devin session token 登录"""
        self.token = token
        try:
            # token 可能是 devin-session-token$xxx 或 auth1_xxx
            if token.startswith('devin-session-token$'):
                jwt_token = token.split('$', 1)[1]
            else:
                jwt_token = token
            
            # 尝试用 token 获取用户状态（正确的请求格式）
            resp = self.session.post(
                f"{self.AUTH_URL}/exa.seat_management_pb.SeatManagementService/GetUserStatus",
                json={
                    "metadata": {
                        "apiKey": token,  # 完整 token，包含前缀
                        "ideName": "windsurf",
                        "ideVersion": "0.0.0",
                        "extensionName": "windsurf-next",
                        "extensionVersion": "1.0.0",
                        "locale": "en"
                    }
                },
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Connect-Protocol-Version": "1"
                }
            )
            
            if resp.status_code == 200:
                data = resp.json()
                self.email = data.get("email", "")
                self.user_id = data.get("firebaseUser", {}).get("user_id", "")
                print(f"[+] Token 验证成功: {self.email}")
                
                # 设置认证头（Devin webapp 需要）
                self.session.headers["x-auth-token"] = token
                self.session.headers["x-devin-session-token"] = token
                self.session.cookies.set("session", jwt_token, domain="app.devin.ai")
                return True
            else:
                print(f"[-] Token 验证失败: HTTP {resp.status_code} - {resp.text[:200]}")
                return False
        except Exception as e:
            print(f"[-] Token 登录异常: {e}")
            return False
    
    def _set_org_header(self):
        """设置 org header"""
        if self.org_id:
            self.session.headers["x-cog-org-id"] = self.org_id
    
    def login_password(self, email: str, password: str) -> bool:
        """密码登录 Devin"""
        try:
            print(f"[*] 尝试密码登录: {email}")
            resp = self.session.post(
                f"{self.BASE_URL}/api/auth1/password/login",
                json={"email": email, "password": password}
            )
            print(f"[*] 登录响应: HTTP {resp.status_code}")
            print(f"[*] Set-Cookie headers: {resp.headers.get('set-cookie', 'None')[:200] if resp.headers.get('set-cookie') else 'None'}")
            print(f"[*] Session cookies: {dict(self.session.cookies)}")
            
            if resp.status_code == 200:
                data = resp.json()
                print(f"[+] 密码登录成功: {email}")
                print(f"[*] 响应数据: {str(data)[:300]}")
                
                # 检查响应中是否有 token
                auth_token = data.get("token", "")
                if auth_token:
                    print(f"[+] 获取到 auth token: {auth_token[:20]}...")
                    # 设置认证头
                    self.session.headers["Authorization"] = f"Bearer {auth_token}"
                    self.session.headers["x-auth-token"] = auth_token
                    self.token = auth_token
                    self.email = data.get("email", email)
                    self.user_id = data.get("user_id", "")
                
                # 登录后调用 post-auth 初始化
                self.post_auth()
                return True
            else:
                print(f"[-] 密码登录失败: {resp.status_code} {resp.text[:300]}")
                return False
        except Exception as e:
            print(f"[-] 登录异常: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def post_auth(self, org_name: str = "") -> bool:
        """登录后初始化，获取用户信息。如果 org_name 不为空则创建/加入组织"""
        try:
            body = {}
            if org_name:
                body["org_name"] = org_name
            resp = self.session.post(f"{self.BASE_URL}/api/users/post-auth", json=body if body else None)
            print(f"[*] post-auth 响应: HTTP {resp.status_code} - {resp.text[:200]}")
            if resp.status_code == 200:
                data = resp.json()
                self.user_id = data.get("user_id")
                self.org_id = data.get("org_id")
                self.org_name = data.get("org_name")
                print(f"[+] post-auth 成功: user_id={self.user_id}, org_id={self.org_id}")
                if self.org_id:
                    self._set_org_header()
                return True
            return False
        except Exception as e:
            print(f"[-] post-auth 异常: {e}")
            return False
    
    def create_org(self, org_name: str = None) -> bool:
        """创建组织（新用户入门流程）"""
        if not org_name:
            # 自动生成组织名（基于邮箱前缀）
            if self.email:
                prefix = self.email.split("@")[0].split("+")[0]
                org_name = f"{prefix}-{int(time.time()) % 1000000}"
            else:
                org_name = f"user-{int(time.time())}"
        
        print(f"[*] 创建组织: {org_name}")
        return self.post_auth(org_name)
    
    def get_organizations(self) -> List[Dict]:
        """获取组织列表"""
        try:
            resp = self.session.get(f"{self.BASE_URL}/api/organizations")
            print(f"[*] organizations API: HTTP {resp.status_code}")
            if resp.status_code == 200:
                orgs = resp.json()
                if orgs:
                    self.org_id = orgs[0].get("org_id")
                    self.org_name = orgs[0].get("name")
                    self._set_org_header()
                    print(f"[+] 获取组织成功: {self.org_name} ({self.org_id})")
                else:
                    print(f"[-] 组织列表为空")
                return orgs
            else:
                print(f"[-] 获取组织失败: {resp.text[:200]}")
            return []
        except Exception as e:
            print(f"[-] 获取组织异常: {e}")
            return []
    
    def get_user_info(self) -> Dict:
        """获取用户信息"""
        try:
            resp = self.session.get(f"{self.BASE_URL}/api/users/info")
            if resp.status_code == 200:
                return resp.json()
            return {}
        except Exception as e:
            print(f"[-] 获取用户信息异常: {e}")
            return {}
    
    def get_checklist_status(self) -> Dict:
        """获取任务清单状态"""
        try:
            self._set_org_header()
            resp = self.session.get(f"{self.BASE_URL}/api/billing/checklist-credit-status")
            if resp.status_code == 200:
                data = resp.json()
                print(f"[*] 任务状态: {json.dumps(data, ensure_ascii=False)}")
                return data
            return {}
        except Exception as e:
            print(f"[-] 获取任务状态异常: {e}")
            return {}
    
    def get_onboarding_state(self) -> Dict:
        """获取引导状态"""
        try:
            resp = self.session.get(f"{self.BASE_URL}/api/users/onboarding-state")
            if resp.status_code == 200:
                return resp.json()
            return {}
        except Exception as e:
            print(f"[-] 获取引导状态异常: {e}")
            return {}
    
    def complete_callout_tour(self, tour_name: str = "automations-sidebar-callout") -> bool:
        """标记引导完成"""
        try:
            self._set_org_header()
            # 使用 PUT /api/users/info 而不是 POST /api/users/preferences
            resp = self.session.put(
                f"{self.BASE_URL}/api/users/info",
                json={"completed_callout_tour": tour_name}
            )
            print(f"[*] 标记引导响应: HTTP {resp.status_code} - {resp.text[:200]}")
            if resp.status_code == 200:
                print(f"[+] 标记引导完成: {tour_name}")
                return True
            return False
        except Exception as e:
            print(f"[-] 标记引导异常: {e}")
            return False
    
    def get_automations(self) -> List:
        """获取自动化列表（触发 automations 任务完成）"""
        if not self.org_id:
            print("[-] 需要先获取 org_id")
            return []
        try:
            self._set_org_header()
            resp = self.session.get(f"{self.BASE_URL}/api/{self.org_id}/automations")
            if resp.status_code == 200:
                print(f"[+] 获取 automations 成功")
                return resp.json()
            return []
        except Exception as e:
            print(f"[-] 获取 automations 异常: {e}")
            return []
    
    def visit_automations_page(self) -> bool:
        """
        模拟访问 automations 页面
        这是触发 $200 积分任务完成的关键步骤
        """
        if not self.org_name:
            print("[-] 需要先获取 org_name")
            return False
        
        try:
            # 1. 访问页面
            page_url = f"{self.BASE_URL}/org/{self.org_name}/automations"
            self.session.headers["Referer"] = page_url
            
            # 2. 获取 automations 列表
            self.get_automations()
            
            # 3. 标记引导完成
            self.complete_callout_tour("automations-sidebar-callout")
            
            # 4. 等待后端处理（可能需要几秒）
            print("[*] 等待后端处理...")
            time.sleep(3)
            
            # 5. 多次验证任务状态
            for i in range(3):
                status = self.get_checklist_status()
                if status.get("completion", {}).get("automations"):
                    break
                if i < 2:
                    print(f"[*] 等待 {2}s 重试...")
                    time.sleep(2)
            
            status = self.get_checklist_status()
            if status.get("completion", {}).get("automations"):
                granted = status.get("granted", {}).get("automations", 0)
                print(f"[+] ✅ automations 任务完成! 获得 ${granted}")
                return True
            else:
                print(f"[-] automations 任务未完成")
                return False
                
        except Exception as e:
            print(f"[-] 访问 automations 页面异常: {e}")
            return False
    
    def run_full_flow(self) -> bool:
        """执行完整流程"""
        print("\n" + "="*50)
        print("[*] 开始执行 Devin 任务自动化流程")
        print("="*50)
        
        # 1. post-auth
        if not self.post_auth():
            print("[-] post-auth 失败，可能 cookie 无效")
            return False
        
        # 2. 获取组织
        orgs = self.get_organizations()
        if not orgs:
            print("[-] 获取组织失败")
            return False
        
        # 3. 检查当前状态
        print("\n[*] 检查当前任务状态...")
        status = self.get_checklist_status()
        completion = status.get("completion", {})
        
        if completion.get("automations"):
            print("[*] automations 任务已完成，跳过")
            granted = status.get("granted", {}).get("automations", 0)
            print(f"[*] 已获得积分: ${granted}")
            return True
        
        # 4. 执行 automations 任务
        print("\n[*] 执行 automations 任务...")
        success = self.visit_automations_page()
        
        print("\n" + "="*50)
        if success:
            print("[+] ✅ 任务完成!")
        else:
            print("[-] ❌ 任务失败")
        print("="*50)
        
        return success


class DevinBrowser:
    """Playwright 浏览器自动化"""
    
    def __init__(self, headless: bool = False):
        self.headless = headless
        self.browser = None
        self.context = None
        self.page = None
    
    def _ensure_playwright(self):
        """确保 Playwright 已安装"""
        try:
            from playwright.sync_api import sync_playwright
            return sync_playwright
        except ImportError:
            print("请安装 Playwright:")
            print("  pip install playwright")
            print("  playwright install chromium")
            sys.exit(1)
    
    def login_github(self, username: str, password: str) -> Optional[str]:
        """
        通过 GitHub OAuth 登录 Devin
        返回登录后的 cookie
        """
        sync_playwright = self._ensure_playwright()
        
        with sync_playwright() as p:
            print("[*] 启动浏览器...")
            self.browser = p.chromium.launch(headless=self.headless)
            self.context = self.browser.new_context()
            self.page = self.context.new_page()
            
            try:
                # 1. 访问 Devin 登录页
                print("[*] 访问 Devin 登录页...")
                self.page.goto("https://app.devin.ai/signup")
                self.page.wait_for_load_state("networkidle")
                time.sleep(2)
                
                # 2. 点击 GitHub 登录按钮
                print("[*] 点击 GitHub 登录...")
                github_btn = self.page.locator('button:has-text("GitHub"), a:has-text("GitHub")')
                if github_btn.count() > 0:
                    github_btn.first.click()
                else:
                    # 尝试其他选择器
                    self.page.click('[data-testid="github-login"], .github-login, button[aria-label*="GitHub"]')
                
                self.page.wait_for_load_state("networkidle")
                time.sleep(2)
                
                # 3. GitHub 登录页面
                if "github.com" in self.page.url:
                    print("[*] 填写 GitHub 凭据...")
                    self.page.fill('input[name="login"]', username)
                    self.page.fill('input[name="password"]', password)
                    self.page.click('input[type="submit"], button[type="submit"]')
                    self.page.wait_for_load_state("networkidle")
                    time.sleep(3)
                    
                    # 处理可能的 2FA 或授权页面
                    if "authorize" in self.page.url.lower():
                        print("[*] 授权 Devin 访问 GitHub...")
                        auth_btn = self.page.locator('button:has-text("Authorize"), button[name="authorize"]')
                        if auth_btn.count() > 0:
                            auth_btn.first.click()
                            self.page.wait_for_load_state("networkidle")
                            time.sleep(3)
                
                # 4. 等待跳转回 Devin
                print("[*] 等待登录完成...")
                for _ in range(30):
                    if "app.devin.ai" in self.page.url and "signup" not in self.page.url:
                        break
                    time.sleep(1)
                
                if "app.devin.ai" not in self.page.url:
                    print(f"[-] 登录可能失败，当前 URL: {self.page.url}")
                    return None
                
                print(f"[+] 登录成功! URL: {self.page.url}")
                
                # 5. 获取 cookies
                cookies = self.context.cookies()
                cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies])
                
                # 6. 执行任务
                print("\n[*] 开始执行任务...")
                self._do_automations_task()
                
                return cookie_str
                
            except Exception as e:
                print(f"[-] 浏览器自动化异常: {e}")
                import traceback
                traceback.print_exc()
                return None
            finally:
                self.browser.close()
    
    def _do_automations_task(self):
        """在浏览器中执行 automations 任务"""
        try:
            # 获取当前 org name (从 URL 或页面)
            current_url = self.page.url
            org_name = None
            
            if "/org/" in current_url:
                # 从 URL 提取 org name
                parts = current_url.split("/org/")
                if len(parts) > 1:
                    org_name = parts[1].split("/")[0].split("?")[0]
            
            if not org_name:
                print("[-] 无法获取 org_name，尝试从页面获取...")
                # 等待页面加载
                time.sleep(3)
                current_url = self.page.url
                if "/org/" in current_url:
                    parts = current_url.split("/org/")
                    if len(parts) > 1:
                        org_name = parts[1].split("/")[0].split("?")[0]
            
            if not org_name:
                print("[-] 无法获取 org_name")
                return
            
            print(f"[+] org_name: {org_name}")
            
            # 导航到 automations 页面
            automations_url = f"https://app.devin.ai/org/{org_name}/automations"
            print(f"[*] 导航到 {automations_url}")
            self.page.goto(automations_url)
            self.page.wait_for_load_state("networkidle")
            time.sleep(3)
            
            print("[+] 已访问 automations 页面")
            
            # 截图保存
            screenshot_path = Path(__file__).parent / f"screenshot_{int(time.time())}.png"
            self.page.screenshot(path=str(screenshot_path))
            print(f"[*] 截图保存: {screenshot_path}")
            
        except Exception as e:
            print(f"[-] 执行任务异常: {e}")


def run_api_mode(cookie: str):
    """协议模式"""
    api = DevinAPI(cookie=cookie)
    return api.run_full_flow()


def run_browser_mode(github_user: str, github_pass: str, headless: bool = False):
    """浏览器模式"""
    browser = DevinBrowser(headless=headless)
    cookie = browser.login_github(github_user, github_pass)
    
    if cookie:
        print(f"\n[+] 获取到 Cookie (可保存用于协议模式):")
        print(f"    {cookie[:100]}...")
        return True
    return False


def run_pool_mode(limit: int = 0, tag_filter: str = "", skip_completed: bool = True):
    """从 windsurf-pool 读取账号并批量处理"""
    accounts = get_windsurf_pool_accounts()
    if not accounts:
        print("[-] 没有找到账号")
        return
    
    # 过滤
    if tag_filter:
        accounts = [a for a in accounts if tag_filter in (a.get("tags") or []) or a.get("tag") == tag_filter]
        print(f"[*] 按标签 '{tag_filter}' 过滤后: {len(accounts)} 个")
    
    # 限制数量
    if limit > 0:
        accounts = accounts[:limit]
        print(f"[*] 限制处理前 {limit} 个账号")
    
    success_count = 0
    skip_count = 0
    fail_count = 0
    
    for i, acc in enumerate(accounts, 1):
        email = acc.get("email", "未知")
        api_key = acc.get("apiKey", "")
        
        print(f"\n{'='*60}")
        print(f"[*] ({i}/{len(accounts)}) {email}")
        print(f"{'='*60}")
        
        # 提取 token
        token = extract_devin_token(api_key)
        if not token:
            print(f"[-] 无法提取 Devin token，跳过")
            skip_count += 1
            continue
        
        try:
            api = DevinAPI(token=token)
            
            # 使用 token 登录
            if not api.login_by_token(token):
                print(f"[-] Token 无效，跳过")
                fail_count += 1
                continue
            
            # 获取组织
            if not api.get_organizations():
                print(f"[-] 获取组织失败，跳过")
                fail_count += 1
                continue
            
            # 检查任务状态
            status = api.get_checklist_status()
            completion = status.get("completion", {})
            
            if skip_completed and completion.get("automations"):
                granted = status.get("granted", {}).get("automations", 0)
                print(f"[*] ✅ 已完成任务，已获得 ${granted}，跳过")
                skip_count += 1
                continue
            
            # 执行任务
            if api.visit_automations_page():
                success_count += 1
            else:
                fail_count += 1
            
            # 账号间隔
            if i < len(accounts):
                time.sleep(2)
                
        except Exception as e:
            print(f"[-] 处理异常: {e}")
            fail_count += 1
    
    print(f"\n{'='*60}")
    print(f"[*] 批量处理完成:")
    print(f"    ✅ 成功: {success_count}")
    print(f"    ⏭️ 跳过: {skip_count}")
    print(f"    ❌ 失败: {fail_count}")
    print(f"{'='*60}")


def run_batch_mode(accounts_file: str, mode: str = "browser", headless: bool = False):
    """批量模式"""
    accounts_path = Path(accounts_file)
    if not accounts_path.exists():
        print(f"[-] 账号文件不存在: {accounts_file}")
        return
    
    with open(accounts_path, "r", encoding="utf-8") as f:
        accounts = json.load(f)
    
    print(f"[*] 加载 {len(accounts)} 个账号")
    
    success_count = 0
    for i, acc in enumerate(accounts, 1):
        print(f"\n{'='*60}")
        print(f"[*] 处理账号 {i}/{len(accounts)}")
        print(f"{'='*60}")
        
        try:
            if mode == "api" and acc.get("cookie"):
                result = run_api_mode(acc["cookie"])
            elif acc.get("github_user") and acc.get("github_pass"):
                result = run_browser_mode(acc["github_user"], acc["github_pass"], headless)
            elif acc.get("email") and acc.get("password"):
                api = DevinAPI()
                if api.login_password(acc["email"], acc["password"]):
                    result = api.run_full_flow()
                else:
                    result = False
            else:
                print(f"[-] 账号配置不完整: {acc}")
                result = False
            
            if result:
                success_count += 1
                
            # 账号间隔
            if i < len(accounts):
                delay = 5
                print(f"[*] 等待 {delay} 秒...")
                time.sleep(delay)
                
        except Exception as e:
            print(f"[-] 账号处理异常: {e}")
    
    print(f"\n{'='*60}")
    print(f"[*] 批量处理完成: {success_count}/{len(accounts)} 成功")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(
        description="Devin AI 任务自动化脚本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 🚀 从 windsurf-pool 批量处理（推荐！）
  python devin_automator.py --mode pool
  python devin_automator.py --mode pool --limit 10 --tag free
  
  # 协议模式 - 使用 cookie
  python devin_automator.py --mode api --cookie "session=xxx; ..."
  
  # 浏览器模式 - GitHub 登录
  python devin_automator.py --mode browser --github-user xxx --github-pass xxx
        """
    )
    
    parser.add_argument("--mode", choices=["pool", "api", "browser", "batch"], default="pool",
                        help="运行模式: pool=windsurf-pool模式(推荐), api=协议模式, browser=浏览器模式, batch=批量模式")
    parser.add_argument("--cookie", help="Cookie 字符串 (api 模式)")
    parser.add_argument("--github-user", help="GitHub 用户名 (browser 模式)")
    parser.add_argument("--github-pass", help="GitHub 密码 (browser 模式)")
    parser.add_argument("--accounts", help="账号 JSON 文件路径 (batch 模式)")
    parser.add_argument("--headless", action="store_true", help="无头模式运行浏览器")
    parser.add_argument("--limit", type=int, default=0, help="限制处理账号数量 (pool 模式)")
    parser.add_argument("--tag", default="", help="按标签过滤 (pool 模式)")
    parser.add_argument("--force", action="store_true", help="强制处理已完成的账号 (pool 模式)")
    
    args = parser.parse_args()
    
    if args.mode == "pool":
        run_pool_mode(limit=args.limit, tag_filter=args.tag, skip_completed=not args.force)
    
    elif args.mode == "api":
        if not args.cookie:
            print("[-] API 模式需要 --cookie 参数")
            print("    提示: 可以从浏览器开发者工具复制 Cookie")
            sys.exit(1)
        run_api_mode(args.cookie)
        
    elif args.mode == "browser":
        if not args.github_user or not args.github_pass:
            print("[-] 浏览器模式需要 --github-user 和 --github-pass 参数")
            sys.exit(1)
        run_browser_mode(args.github_user, args.github_pass, args.headless)
        
    elif args.mode == "batch":
        if not args.accounts:
            print("[-] 批量模式需要 --accounts 参数")
            sys.exit(1)
        run_batch_mode(args.accounts, "browser", args.headless)


if __name__ == "__main__":
    main()
