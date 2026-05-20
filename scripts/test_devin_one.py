#!/usr/bin/env python3
"""快速测试单个 Devin 账号"""
import sys
import json
sys.path.insert(0, '.')
from scripts.devin_automator import DevinAPI

# 测试账号
email = "moniaktar812480+vcdwvwfx@gmail.com"
password = "ar15c4n97adj"

api = DevinAPI()

print("="*60)
print(f"[*] 测试账号: {email}")
print("="*60)

# 1. 密码登录
if not api.login_password(email, password):
    print("[-] 登录失败")
    sys.exit(1)

# 2. 获取组织
orgs = api.get_organizations()
if not orgs:
    print("[*] 没有组织，尝试创建...")
    if not api.create_org():
        print("[-] 创建组织失败")
        sys.exit(1)
    
    # 重新获取组织
    orgs = api.get_organizations()
    if not orgs:
        print("[-] 仍然获取不到组织")
        sys.exit(1)

# 3. 获取用户详细信息
user_info = api.get_user_info()
print(f"[*] 用户信息: {json.dumps(user_info, indent=2)[:500]}")

# 4. 获取引导状态
onboarding = api.get_onboarding_state()
print(f"[*] 引导状态: {json.dumps(onboarding, indent=2)[:300]}")

# 5. 检查任务状态
status = api.get_checklist_status()
completion = status.get("completion", {})
print(f"[*] 当前任务状态: {completion}")

if completion.get("automations"):
    granted = status.get("granted", {}).get("automations", 0)
    print(f"[*] ✅ 已完成任务，已获得 ${granted}")
else:
    # 4. 执行任务
    print("[*] 执行 automations 任务...")
    if api.visit_automations_page():
        print("[+] ✅ 任务完成!")
    else:
        print("[-] ❌ 任务失败")

print("="*60)
