"""
Devin 批量账号薅200美元
- 自动登录 Devin + 完成 Onboarding + 创建 Automation → 领取 $200 credits
- 预检查额度：已有额度 > 5 的号自动跳过
"""
import asyncio
import json
import re
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from playwright.async_api import async_playwright, Page, TimeoutError as PlaywrightTimeout

FIREBASE_API_KEY = "AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY"
CREDITS_THRESHOLD_USD = 5  # 额外用量余额 > $5 则跳过（做过新手任务的号有 $200）


def _post_json(url: str, body: dict, extra_headers: dict = None) -> dict:
    """同步 HTTP POST JSON，返回 {status, body}"""
    data = json.dumps(body).encode('utf-8')
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return {'status': resp.status, 'body': resp.read().decode('utf-8')}
    except urllib.error.HTTPError as e:
        return {'status': e.code, 'body': e.read().decode('utf-8', errors='replace')}
    except Exception as e:
        return {'status': 0, 'body': str(e)}


def _detect_auth_method(email: str) -> dict:
    """检测认证方式，返回 {method, has_password}"""
    r = _post_json('https://windsurf.com/_devin-auth/connections', {'product': 'windsurf', 'email': email})
    if r['status'] == 200:
        try:
            d = json.loads(r['body'])
            am = d.get('auth_method', {})
            return {'method': (am.get('method', 'firebase')).lower(),
                    'has_password': am.get('has_password')}
        except:
            pass
    return {'method': 'firebase', 'has_password': None}


def _login_auth1(email: str, password: str) -> str | None:
    """Auth1 登录，返回 sessionToken 或 None"""
    lr = _post_json('https://windsurf.com/_devin-auth/password/login', {'email': email, 'password': password})
    if lr['status'] != 200:
        return None
    try:
        d = json.loads(lr['body'])
        auth1_token = d.get('token', '')
        user_id = d.get('user_id', '')
    except:
        return None
    if not auth1_token:
        return None
    
    pa = _post_json(
        'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth',
        {},
        {'Connect-Protocol-Version': '1', 'X-Devin-Auth1-Token': auth1_token, 'X-Devin-Account-Id': user_id}
    )
    if pa['status'] != 200:
        return None
    try:
        pd = json.loads(pa['body'])
        return pd.get('sessionToken') or pd.get('session_token')
    except:
        return None


def _login_firebase(email: str, password: str) -> str | None:
    """Firebase 登录，返回 apiKey 或 None"""
    fr = _post_json(
        f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}',
        {'email': email, 'password': password, 'returnSecureToken': True, 'clientType': 'CLIENT_TYPE_WEB'}
    )
    if fr['status'] != 200:
        return None
    try:
        fb = json.loads(fr['body'])
        id_token = fb.get('idToken', '')
    except:
        return None
    if not id_token:
        return None
    
    rr = _post_json(
        'https://register.windsurf.com/exa.api_server_pb.ApiServerService/RegisterUser',
        {'firebase_id_token': id_token},
        {'connect-protocol-version': '1'}
    )
    if rr['status'] != 200:
        return None
    try:
        rd = json.loads(rr['body'])
        return rd.get('api_key') or rd.get('apiKey')
    except:
        return None


def _login(email: str, password: str) -> tuple[str | None, str]:
    """
    登录主函数（与插件 login() 逻辑一致）：
    auto 检测 → auth1（有密码才试）→ firebase fallback
    返回 (api_key, api_server) 或 (None, '')
    """
    det = _detect_auth_method(email)
    method = det['method']
    has_password = det.get('has_password')
    
    if method == 'auth1' and has_password is not False:
        key = _login_auth1(email, password)
        if key:
            return key, 'https://server.self-serve.windsurf.com'
    
    # fallback firebase
    key = _login_firebase(email, password)
    if key:
        return key, 'https://server.codeium.com'
    
    return None, ''


def _query_balance(api_key: str) -> tuple[float, str]:
    """调用 GetPlanStatus 获取余额美元和套餐名"""
    r = _post_json(
        'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus',
        {'includeTopUpStatus': True},
        {'Accept': 'application/json', 'Connect-Protocol-Version': '1',
         'x-auth-token': api_key, 'x-devin-session-token': api_key}
    )
    if r['status'] != 200:
        return 0.0, ''
    try:
        d = json.loads(r['body'])
        ps = d.get('planStatus', d)
        plan = ps.get('planInfo', {}).get('planName', '')
        top_up = d.get('topUpStatus', {})
        micros = top_up.get('overageBalanceMicros') or top_up.get('balanceMicros') or ps.get('overageBalanceMicros') or 0
        return int(micros) / 1_000_000, plan
    except:
        return 0.0, ''


def _check_one(args, retries=3):
    """并发查询单个账号，失败重试 retries 次"""
    import time
    email, password = args
    last_err = ''
    for attempt in range(retries):
        if attempt > 0:
            time.sleep(1)  # 重试间隔
        try:
            api_key, api_server = _login(email, password)
            if not api_key:
                last_err = '登录失败'
                continue
            balance_usd, plan = _query_balance(api_key)
            return email, {'balance_usd': balance_usd, 'plan': plan,
                           'api_key': api_key, 'api_server': api_server}
        except Exception as e:
            last_err = str(e)
    return email, None

GITHUB_EMAIL = "wnovonw@gmail.com"
GITHUB_PASSWORD = "743521.locky"

DEVIN_ACCOUNTS = [
    # ===== 用户提供的新批次与混合历史列表 =====
    ("capcaseeir@gmail.com", "i17syial0"),
    ("caresserw@gmail.com", "l97f3qu5gku"),
    ("lupulusdb@gmail.com", "a20hk534nk"),
    ("italicty8@gmail.com", "2t45geqy2s"),
    ("untincxd3@gmail.com", "mcbe3o29fo"),
    ("vhke54199054983@gmail.com", "c4wqz5gw3NrYgb"),
    ("vgawne24@gmail.com", "lqmspV37PPB63U"),
    ("vcwele789483633@gmail.com", "41H9iTtJ2vO5U8"),
    ("vhfhqr629369@gmail.com", "0zPbSsLbA299wW"),
    ("vela34646346532@gmail.com", "eUC95EaxQZcK0d"),
    ("vcsflc016763041@gmail.com", "g4A5CcJK34RveS"),
    ("vewwym6010672@gmail.com", "x5T4BiNE6JLxgA"),
    ("vicjdy51012542@gmail.com", "x0g2Y524vRT5L4"),

    ("lyonsmarleigh51@gmail.com", "UBphmt2K9933"),
    ("gracelynnburns955@gmail.com", "9Apbcl4Nb1qk"),
    ("phrmcrtr@gmail.com", "mpRPQMYu0wOn"),
    ("woodwardemersyn316@gmail.com", "1SNPNLJv5233"),
    ("zayneshaw20@gmail.com", "6sbo8N0x8REL"),

    ("challotef6@gmail.com", "3bc6c8bi"),
    ("david2657179318@gmail.com", "OqRGYn6%%k5$xB"),
    ("nlam8447915725@gmail.com", "2gd$##Bv5xEcKx"),
    ("williamwallace089273008@gmail.com", "bsIOSBHukJ@1tG"),
    ("hmontgomery3447188@gmail.com", "HEU2Bg$ro%B8Wh"),
    ("jameswilliams464918@gmail.com", "T3Kb7Wm%mvTN#4"),
    ("robert31565211@gmail.com", "fF$27@#MLHfpxM"),

    ("yfgeiel88379@gmail.com", "kY83Pti4MpRBKRmX"),
    ("yflis6628090518@gmail.com", "EgWj3Um#C@sBpPup"),
    ("ybbgv79218665@gmail.com", "!0mydwnAlVLNqfVN"),
    ("ynwf55569497@gmail.com", "dxsdoZYcaU!kmw6P"),
    ("yhfhwqv82532894@gmail.com", "N@mFi!OdtUH@$!1D"),
    ("ydcxk2959657@gmail.com", "qWdODvZr6BdEauyf"),
    ("ypebplx661157@gmail.com", "$wTyV6jkcFoEa0LL"),
    ("ygpnrk45440650@gmail.com", "k1b4JdfWKA0IYKxj"),
    ("ygwvgp055466674@gmail.com", "B!QvjWFE1xxjuE7l"),
    ("ygevtv729046551@gmail.com", "Pl5BcvKbwSFGmKW5"),

    ("patricia0381269566@gmail.com", "Hg0hT8Glg0Sg"),
    ("heidi21344801@gmail.com", "e3jN4etuXcDn"),
    ("antonio349584140204@gmail.com", "dvtvmgdeSZg6"),
    ("odavis594507@gmail.com", "mEhcrN3MpJ6G"),
    ("timothywarren086067471@gmail.com", "in9kEiKA3kNO"),

    ("wayne19910806@proton.me", "LJs76XLYnqmuNC"),
    ("carol19931225@proton.me", "LJZWsxSqIq8uoK"),
    ("marie20050309@proton.me", "LJDTnq2LrSjkae"),
    ("harry19910724@proton.me", "LJqPsTLBw21DDw"),
    ("sienna20000223@proton.me", "LJndq9JLS1amKf"),
    ("edgar19990603@proton.me", "LJ9c86hOvFdbEa"),
    ("sofia19910826@proton.me", "LJ2Z5tLBtbRJt6"),
    ("maggie19940410@proton.me", "LJM1U8adO2ZbVC"),
    ("kurt19960912@proton.me", "LJRWXys0KsUK62"),
]


async def safe_click(page: Page, role: str, name: str, timeout: int = 3000) -> bool:
    """安全点击元素，存在才点击"""
    try:
        el = page.get_by_role(role, name=name)
        await el.wait_for(state="visible", timeout=timeout)
        await el.click()
        return True
    except Exception:
        return False


async def safe_fill(page: Page, role: str, name: str, value: str, timeout: int = 5000) -> bool:
    """安全填充输入框"""
    try:
        el = page.get_by_role(role, name=name)
        await el.wait_for(state="visible", timeout=timeout)
        await el.fill(value)
        return True
    except Exception:
        return False


async def login_devin(page: Page, email: str, password: str) -> bool:
    """登录 Devin"""
    # 如果不在登录页则导航
    if "/auth/login" not in page.url:
        await page.goto("https://app.devin.ai/auth/login", timeout=15000)
        await page.wait_for_timeout(1500)
    
    # 输入邮箱
    if not await safe_fill(page, "textbox", "Email address", email):
        print("  ✗ 找不到邮箱输入框")
        return False
    
    if not await safe_click(page, "button", "Log in"):
        print("  ✗ 找不到登录按钮")
        return False
    
    await page.wait_for_timeout(1500)
    
    # 输入密码
    if not await safe_fill(page, "textbox", "Password", password):
        print("  ✗ 找不到密码输入框")
        return False
    
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(3000)
    
    # 检查是否登录成功
    if "/org/" in page.url:
        print("  ✓ 登录成功")
        return True
    
    print(f"  ✗ 登录失败，URL: {page.url}")
    return False


async def do_onboarding(page: Page, github_page: Page) -> bool:
    """完成引导流程"""
    await page.wait_for_timeout(1000)
    
    # 1. 选择来源
    if await safe_click(page, "button", "Friend", 2000):
        print("  ✓ 选择来源: Friend")
        await page.wait_for_timeout(1500)
    
    # 2. 连接 GitHub
    if await safe_click(page, "button", "Connect GitHub", 2000):
        print("  → 连接 GitHub...")
        await page.wait_for_timeout(3000)
        
        # 如果跳转到 GitHub 登录页（在当前 page 上）
        if "github.com" in page.url:
            try:
                await page.fill('input[name="login"]', GITHUB_EMAIL, timeout=5000)
                await page.fill('input[name="password"]', GITHUB_PASSWORD, timeout=5000)
                await page.click('input[type="submit"]')
                await page.wait_for_timeout(3000)
                print("  ✓ GitHub OAuth 登录")
            except:
                print("  ⚠ GitHub OAuth 跳过")
        
        # 等待返回 Devin
        await page.wait_for_timeout(2000)
    
    await page.wait_for_timeout(1500)
    
    # 3. Create workspace
    if await safe_click(page, "button", "Create workspace", 2000):
        print("  → Create workspace")
        await page.wait_for_timeout(1500)
        
        # 尝试点击 Skip for now
        if await safe_click(page, "button", "Skip for now", 2000):
            print("  → Skip for now")
            await page.wait_for_timeout(1500)
    
    # 4. Need admin approval? → CLI 方式
    if await safe_click(page, "button", "Need admin approval?", 2000):
        print("  → CLI 方式连接")
        await page.wait_for_timeout(1500)
        
        if await safe_click(page, "button", "Run", 2000):
            await page.wait_for_timeout(3000)
            
            # 获取设备码
            try:
                code_el = page.locator("text=/One-time code:/")
                text = await code_el.text_content(timeout=5000)
                match = re.search(r'([A-Z0-9]{4}-[A-Z0-9]{4})', text)
                if match:
                    code = match.group(1)
                    print(f"  ✓ 设备码: {code}")
                    
                    # GitHub 授权
                    await github_page.goto("https://github.com/login/device")
                    await github_page.wait_for_timeout(2000)
                    
                    # 点击 Continue (选择账号) - 用 locator 找精确的
                    try:
                        cont = github_page.locator('button:has-text("Continue"):not(:has-text("with"))')
                        await cont.first.click(timeout=3000)
                    except:
                        pass
                    await github_page.wait_for_timeout(1500)
                    
                    # 输入设备码
                    chars = code.replace("-", "")
                    for i, c in enumerate(chars):
                        idx = i if i < 4 else i + 1
                        await safe_fill(github_page, "textbox", f"User code {idx}", c, 2000)
                    
                    # 点击 Continue 提交设备码
                    try:
                        cont2 = github_page.locator('button:has-text("Continue"):not(:has-text("with"))')
                        await cont2.first.click(timeout=3000)
                    except:
                        pass
                    await github_page.wait_for_timeout(2000)
                    
                    # 授权
                    auth_btn = github_page.get_by_role("button", name=re.compile(r"Authorize"))
                    try:
                        await auth_btn.first.click(timeout=3000)
                        print("  ✓ GitHub CLI 授权完成")
                    except:
                        pass
                    
                    # 切换回 Devin 页面
                    await page.bring_to_front()
                    await page.wait_for_timeout(5000)
            except Exception as e:
                print(f"  ⚠ 设备码获取失败: {e}")
    
    # 5. 完成引导 (多次 Continue)
    for _ in range(8):
        await page.wait_for_timeout(800)
        if not await safe_click(page, "button", "Continue", 1500):
            break
    
    # 6. 处理 "Are you sure?" 对话框
    await page.wait_for_timeout(1000)
    later_btn = page.get_by_role("button", name="I'll do it later")
    try:
        if await later_btn.is_visible():
            await later_btn.click()
            await page.wait_for_timeout(2000)
    except:
        pass
    
    # 7. 验证成功：展开 Advanced 并检查 "Set up automations"
    await page.wait_for_timeout(2000)
    show_adv = page.get_by_role("button", name="Show advanced tips")
    try:
        if await show_adv.is_visible():
            await show_adv.click()
            await page.wait_for_timeout(1000)
    except:
        pass
    
    # 点击 "Set up automations" 链接进入创建页面
    setup_auto = page.get_by_role("link", name=re.compile(r"Set up automations"))
    try:
        if await setup_auto.is_visible():
            await setup_auto.click()
            await page.wait_for_timeout(2000)
            print("  ✓ 进入 Set up automations")
            return True
    except:
        pass
    
    print("  ✓ 引导完成")
    return True


async def create_automation(page: Page, org_slug: str = None) -> bool:
    """创建 Automation"""
    # 获取 org slug
    if not org_slug:
        match = re.search(r'/org/([^/?]+)', page.url)
        if match:
            org_slug = match.group(1)
    
    if not org_slug:
        # 尝试导航到主页获取
        try:
            await page.goto("https://app.devin.ai", timeout=30000)
            await page.wait_for_timeout(3000)
            match = re.search(r'/org/([^/?]+)', page.url)
            if match:
                org_slug = match.group(1)
        except:
            pass
    
    if not org_slug:
        print("  ✗ 无法获取 org slug")
        return False
    
    await page.goto(f"https://app.devin.ai/org/{org_slug}/automations/create", timeout=30000)
    await page.wait_for_timeout(2000)
    
    # 关闭侧边栏的 Automations 弹窗（$200 credits 提示）
    for _ in range(3):
        try:
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(300)
        except:
            pass
    
    # 点击主区域确保聚焦
    try:
        main = page.locator('main')
        await main.click(timeout=2000)
        await page.wait_for_timeout(500)
    except:
        pass
    
    # 填写名称
    await safe_fill(page, "textbox", "Automation name", "Test Automation")
    
    # 添加触发器 - 点击大的 Add Trigger 按钮
    try:
        triggers = page.get_by_role("button", name="Add Trigger", exact=True)
        await triggers.last.click(timeout=5000)
        await page.wait_for_timeout(800)
        await safe_click(page, "menuitem", "Schedule", 3000)
        await page.wait_for_timeout(800)
        await safe_click(page, "menuitem", "Every hour", 3000)
        await page.wait_for_timeout(500)
    except Exception as e:
        print(f"  ⚠ 添加触发器失败: {e}")
    
    # 填写指令
    try:
        box = page.locator('[contenteditable="true"], textarea').first
        await box.fill("Check system status", timeout=3000)
    except:
        pass
    
    # 创建
    await safe_click(page, "button", "Create automation", 3000)
    await page.wait_for_timeout(3000)
    
    if "/automations/auto-" in page.url:
        print("  ✓ Automation 创建成功")
        
        # 验证 checklist 是否亮起
        await page.goto(f"https://app.devin.ai/org/{org_slug}", timeout=30000)
        await page.wait_for_timeout(2000)
        
        # 检查 Set up automations 是否有 checked 状态
        setup_auto = page.locator('text="Set up automations"')
        try:
            parent = setup_auto.locator('xpath=ancestor::a | ancestor::button').first
            checkbox = parent.locator('input[type="checkbox"], [role="checkbox"]').first
            if await checkbox.is_checked():
                print("  ✓ Set up automations 已完成 ✓")
        except:
            pass
        
        return True
    
    print("  ⚠ Automation 状态未知")
    return False


async def process_account(context, page: Page, github_page: Page, email: str, password: str, idx: int):
    """处理单个账号"""
    print(f"\n[{idx}] {email}")
    
    # 直接导航到登录页（新 context 已是干净的）
    await page.goto("https://app.devin.ai/auth/login", timeout=30000)
    await page.wait_for_timeout(2000)
    
    # 登录
    if not await login_devin(page, email, password):
        return False
    
    # 引导
    await do_onboarding(page, github_page)
    
    # 创建 Automation
    await create_automation(page)
    
    print(f"  ✅ 账号 {idx} 完成")
    return True


async def main():
    print("=" * 50)
    print("Devin 批量账号薅200美元")
    print("=" * 50)
    
    # ===== 阶段 1: 并发批量查询余额 =====
    print(f"\n{'─' * 50}")
    print(f"阶段 1: 并发查询余额（共 {len(DEVIN_ACCOUNTS)} 个账号）")
    print(f"{'─' * 50}")
    
    to_process = []  # 需要做新手任务的账号
    skipped = []     # 已做过的账号
    failed = []      # 登录失败的账号
    
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(_check_one, (email, pwd)): (email, pwd)
                   for email, pwd in DEVIN_ACCOUNTS}
        for future in as_completed(futures):
            email, result = future.result()
            pwd = next(p for e, p in DEVIN_ACCOUNTS if e == email)
            if result is None:
                print(f"  ❌ {email} → 登录失败")
                failed.append(email)
            elif result['balance_usd'] > CREDITS_THRESHOLD_USD:
                print(f"  ✅ {email} → ${result['balance_usd']:.2f} 已做过")
                skipped.append(email)
            else:
                print(f"  🔲 {email} → ${result['balance_usd']:.2f} 待做")
                to_process.append((email, pwd))
    
    print(f"\n{'─' * 50}")
    print(f"汇总: ✅已做过 {len(skipped)} | 🔲待做 {len(to_process)} | ❌失败 {len(failed)} | 共 {len(DEVIN_ACCOUNTS)}")
    print(f"{'─' * 50}")
    
    if not to_process:
        print("\n🎉 全部已完成或无法登录，无需操作！")
        return
    
    # ===== 阶段 2: 批量做新手任务 =====
    print(f"\n{'─' * 50}")
    print(f"阶段 2: 开始做新手任务（{len(to_process)} 个账号）")
    print(f"{'─' * 50}")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        for i, (email, pwd) in enumerate(to_process, 1):
            context = await browser.new_context()
            try:
                page = await context.new_page()
                github_page = await context.new_page()
                
                # GitHub 预登录
                await github_page.goto("https://github.com/login", timeout=15000)
                await github_page.fill('input[name="login"]', GITHUB_EMAIL)
                await github_page.fill('input[name="password"]', GITHUB_PASSWORD)
                await github_page.click('input[type="submit"]')
                await github_page.wait_for_timeout(3000)
                
                await process_account(context, page, github_page, email, pwd, i)
            except Exception as e:
                print(f"  ❌ 失败: {e}")
            finally:
                await context.close()
        
        print("\n" + "=" * 50)
        print("完成!")
        await browser.close()


if __name__ == "__main__":
    import sys
    if '--query-only' in sys.argv:
        # 只查询不做任务
        print("=" * 50)
        print("Devin 批量账号薅200美元 - 仅查询模式")
        print("=" * 50)
        print(f"\n{'─' * 50}")
        print(f"并发查询余额（共 {len(DEVIN_ACCOUNTS)} 个账号）")
        print(f"{'─' * 50}")
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(_check_one, (e, p)): e for e, p in DEVIN_ACCOUNTS}
            done, skip, fail = 0, 0, 0
            for future in as_completed(futures):
                email, result = future.result()
                if result is None:
                    print(f"  ❌ {email} → 登录失败")
                    fail += 1
                elif result['balance_usd'] > CREDITS_THRESHOLD_USD:
                    print(f"  ✅ {email} → ${result['balance_usd']:.2f}")
                    skip += 1
                else:
                    print(f"  🔲 {email} → ${result['balance_usd']:.2f}")
                    done += 1
            print(f"\n{'─' * 50}")
            print(f"✅已做过 {skip} | 🔲待做 {done} | ❌失败 {fail} | 共 {len(DEVIN_ACCOUNTS)}")
    else:
        asyncio.run(main())
