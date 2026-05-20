#!/usr/bin/env python3
"""
Devin 任务自动化 - 完整流程（GitHub OAuth 方式）：
1. 邮箱密码登录 Devin
2. 点击 Connect GitHub（OAuth 按钮）
3. 跳转到 GitHub OAuth 授权页面
4. GitHub 登录并授权
5. 回调到 Devin，完成连接 → 获得 $200
"""
import time
import re
from playwright.sync_api import sync_playwright

# Devin 测试账号
email = "moniaktar812480+vcdwvwfx@gmail.com"
password = "ar15c4n97adj"

# GitHub 账号
github_email = "859456603@qq.com"
github_password = "743521.locky"

def run():
    with sync_playwright() as p:
        # 启动浏览器（有头模式，方便观察）
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        
        print("="*60)
        print(f"[*] 测试账号: {email}")
        print("="*60)
        
        # 1. 打开登录页
        print("[*] 打开登录页...")
        page.goto("https://app.devin.ai/auth/login", timeout=60000)
        time.sleep(2)
        
        # 2. 填写邮箱
        print("[*] 填写邮箱...")
        email_input = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]')
        email_input.wait_for(timeout=30000)
        email_input.fill(email)
        
        # 3. 提交邮箱
        print("[*] 提交邮箱...")
        submit_btn = page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Next")')
        submit_btn.first.click()
        time.sleep(3)
        
        # 4. 填写密码
        print("[*] 填写密码...")
        password_input = page.locator('input[type="password"], input[name="password"]')
        password_input.wait_for(timeout=30000)
        password_input.fill(password)
        
        # 5. 点击登录
        print("[*] 点击登录...")
        login_btn = page.locator('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")')
        login_btn.first.click()
        time.sleep(5)
        
        print(f"[*] 当前 URL: {page.url}")
        
        # 6. 处理 "How did you hear about us?" 问卷（等待页面加载）
        time.sleep(3)
        print(f"[*] 检查页面内容...")
        
        # 多次检查问卷页面
        for _ in range(5):
            if "How did you hear about us" in page.content() or "hear about" in page.content():
                print("[*] 发现来源问卷，点击 Friend...")
                friend_btn = page.locator('button:has-text("Friend")')
                if friend_btn.count() > 0:
                    friend_btn.click()
                    time.sleep(3)
                    print("[+] 选择了 Friend")
                    break
            time.sleep(2)
        
        # 7. 查找并点击 Connect GitHub（OAuth 方式）
        print("[*] 查找 Connect GitHub 按钮...")
        
        # 可能的按钮文本
        github_btn = page.locator('button:has-text("Connect GitHub"), a:has-text("Connect GitHub"), button:has-text("GitHub organization")')
        if github_btn.count() > 0:
            print("[*] 点击 Connect GitHub...")
            github_btn.first.click()
            time.sleep(3)
        
        # 7. 处理 GitHub OAuth 页面
        print(f"[*] 当前 URL: {page.url}")
        
        if "github.com" in page.url:
            print("[*] 进入 GitHub OAuth 页面")
            
            # 如果需要登录 GitHub
            if "/login" in page.url:
                print("[*] 需要登录 GitHub...")
                login_field = page.locator('input[name="login"]')
                if login_field.count() > 0:
                    login_field.fill(github_email)
                    page.fill('input[name="password"]', github_password)
                    page.click('input[type="submit"], button[type="submit"]')
                    time.sleep(5)
                    print(f"[*] 登录后 URL: {page.url}")
            
            # 如果在授权页面，点击 Authorize
            if "/oauth/authorize" in page.url or "Authorize" in page.content():
                print("[*] 点击 Authorize...")
                auth_btn = page.locator('button:has-text("Authorize"), input[value*="Authorize"]')
                if auth_btn.count() > 0:
                    auth_btn.first.click()
                    time.sleep(5)
        
        # 8. 等待回调到 Devin
        print("[*] 等待返回 Devin...")
        time.sleep(5)
        print(f"[*] 当前 URL: {page.url}")
        
        # 8.5 再次检查 "How did you hear about us?" 问卷（返回后可能显示）
        for _ in range(5):
            if "How did you hear about us" in page.content() or "hear about" in page.content():
                print("[*] 发现来源问卷，点击 Friend...")
                friend_btn = page.locator('button:has-text("Friend")')
                if friend_btn.count() > 0:
                    friend_btn.click()
                    time.sleep(3)
                    print("[+] 选择了 Friend")
                    break
            time.sleep(1)
        
        # 9. 检查是否成功
        if "onboarding-git-success" in page.url or "github_connected" in page.url:
            print("[+] ✅ GitHub 连接成功！")
        
        # 10. 导航到 automations 页面完成任务
        if "/org/" in page.url:
            org_name = page.url.split("/org/")[1].split("/")[0].split("?")[0]
            automations_url = f"https://app.devin.ai/org/{org_name}/automations"
            print(f"[*] 导航到 automations: {automations_url}")
            page.goto(automations_url, timeout=60000)
            time.sleep(5)
        
        # 11. 截图并保持打开
        page.screenshot(path="devin_result.png")
        print(f"[*] 最终 URL: {page.url}")
        print("[+] 已截图: devin_result.png")
        
        print("[*] 浏览器保持打开，按 Ctrl+C 退出")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        
        browser.close()
        print("="*60)

if __name__ == "__main__":
    run()
