#!/usr/bin/env python3
"""
视频分析脚本 - 通过 Gemini 网页内部 API（逆向）
无需 API Key，只需登录 Google 账号后获取 Cookie。

原理：模拟 gemini.google.com 的浏览器行为
  1. 从网页 HTML 提取 SNlM0e (CSRF) 和 cfb2h (版本号)
  2. 通过 Resumable Upload 上传视频到 content-push.googleapis.com
  3. 发送聊天请求到 BardFrontendService/StreamGenerate
  4. 解析嵌套 JSON 流式响应

用法:
  python analyze_video_web.py <video_path> --cookie-file <cookie.txt> [--prompt <prompt>] [--model <model>]
  python analyze_video_web.py <video_path> --cookie "<cookie_string>" [--prompt <prompt>] [--model <model>]

获取 Cookie:
  1. 在浏览器中登录 gemini.google.com
  2. F12 → Network → 刷新页面 → 找任意请求 → 复制 Cookie 头
  3. 或者用 EditThisCookie 等扩展导出

模型选择 (--model):
  gemini-3-flash          默认，快速
  gemini-3-flash-thinking 带思考过程
  gemini-3-pro            Pro 模型
"""
import argparse
import json
import mimetypes
import os
import re
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("[INFO] 安装 requests...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests


# ========== 模型配置 ==========
MODEL_HEADERS = {
    "gemini-3-flash":          '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
    "gemini-3-flash-thinking": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
    "gemini-3-pro":            '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
}

DEFAULT_PROMPT = """请全面分析这个视频：
1. 内容概要：视频主题和主要内容
2. 关键场景：列出关键场景/片段及大致时间点
3. 视觉元素：重要的视觉元素（UI界面、文字、图形、人物等）
4. 语音内容：对话、旁白或重要音频内容摘要
5. 技术细节：视频质量、风格、转场等制作技巧
6. 核心要点：主要结论或关键信息
请用中文回复。"""


# ========== Step 1: 认证 ==========
def fetch_request_params(cookie: str, user_index: str = "0") -> dict:
    """从 Gemini 网页 HTML 中提取认证参数 (SNlM0e, cfb2h)"""
    url = "https://gemini.google.com/app"
    if user_index and user_index != "0":
        url = f"https://gemini.google.com/u/{user_index}/app"

    print(f"[INFO] 获取认证参数: {url}")
    resp = requests.get(url, headers={
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    })

    if resp.status_code != 200:
        raise Exception(f"获取页面失败: HTTP {resp.status_code}")

    html = resp.text

    # 提取 SNlM0e (at token, CSRF)
    at_match = re.search(r'"SNlM0e":"([^"]+)"', html)
    if not at_match:
        if "Sign in" in html or "accounts.google.com" in html:
            raise Exception("未登录！请确认 Cookie 有效且已登录 Google 账号")
        raise Exception("无法提取 SNlM0e，Cookie 可能已过期")
    at_value = at_match.group(1)

    # 提取 cfb2h (bl, 版本号)
    bl_match = re.search(r'"cfb2h":"([^"]+)"', html)
    bl_value = bl_match.group(1) if bl_match else "boq_assistant-bard-web-server_20230713.13_p0"

    # 提取 authuser
    auth_match = re.search(r'data-index="(\d+)"', html)
    auth_user = auth_match.group(1) if auth_match else user_index

    print(f"[OK] 认证成功 (authUser={auth_user})")
    return {"at": at_value, "bl": bl_value, "auth_user": auth_user}


# ========== Step 2: 上传视频 ==========
def upload_video(file_path: str, cookie: str) -> str:
    """
    通过 Resumable Upload 上传视频到 content-push.googleapis.com
    
    流程:
    1. POST start → 获取 X-Goog-Upload-URL
    2. POST upload+finalize → 上传二进制数据
    3. 返回文件标识符
    """
    file_size = os.path.getsize(file_path)
    mime_type = mimetypes.guess_type(file_path)[0] or "video/mp4"
    file_name = os.path.basename(file_path)

    print(f"[INFO] 上传视频: {file_name} ({file_size / (1024*1024):.1f} MB, {mime_type})")

    # Step 2a: 初始化可断点续传会话
    init_headers = {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Type": mime_type,
        "X-Goog-Upload-Header-Content-Length": str(file_size),
        "Push-ID": "feeds/mcudyrk2a4khkz",
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Origin": "https://gemini.google.com",
        "Referer": "https://gemini.google.com/",
    }

    init_resp = requests.post(
        "https://content-push.googleapis.com/upload",
        headers=init_headers,
    )

    if init_resp.status_code != 200:
        # 降级：尝试简单上传方式（FormData）
        print(f"[WARN] Resumable 初始化失败 ({init_resp.status_code})，尝试简单上传...")
        return _upload_simple(file_path, cookie)

    upload_url = init_resp.headers.get("X-Goog-Upload-URL")
    if not upload_url:
        print("[WARN] 未获取到 Upload URL，尝试简单上传...")
        return _upload_simple(file_path, cookie)

    print(f"[INFO] 获取上传地址，开始传输数据...")

    # Step 2b: 上传文件二进制数据
    with open(file_path, "rb") as f:
        file_data = f.read()

    upload_headers = {
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
        "Content-Type": "application/octet-stream",
        "Cookie": cookie,
    }

    t0 = time.time()
    upload_resp = requests.post(upload_url, headers=upload_headers, data=file_data)
    elapsed = time.time() - t0

    if upload_resp.status_code != 200:
        raise Exception(f"上传失败: HTTP {upload_resp.status_code}")

    file_id = upload_resp.text.strip()
    print(f"[OK] 上传完成 ({elapsed:.1f}s): {file_id[:80]}...")
    return file_id


def _upload_simple(file_path: str, cookie: str) -> str:
    """简单上传方式（FormData），gemini-nexus 原有实现"""
    with open(file_path, "rb") as f:
        files = {"file": (os.path.basename(file_path), f)}
        headers = {
            "Push-ID": "feeds/mcudyrk2a4khkz",
            "Cookie": cookie,
            "Origin": "https://gemini.google.com",
            "Referer": "https://gemini.google.com/",
        }
        resp = requests.post(
            "https://content-push.googleapis.com/upload",
            headers=headers,
            files=files,
        )

    if resp.status_code != 200:
        raise Exception(f"简单上传失败: HTTP {resp.status_code} - {resp.text[:200]}")

    return resp.text.strip()


# ========== Step 3: 发送聊天请求 ==========
def send_message(prompt: str, file_id: str, file_name: str,
                 auth: dict, cookie: str, model: str = "gemini-3-flash") -> dict:
    """
    发送带视频的聊天请求到 Gemini Web API
    返回 {"text": "...", "thoughts": "...", "ids": [...]}
    """
    # 构造消息体
    file_list = [[[file_id], file_name]]
    message_struct = [prompt, 0, None, file_list]
    data = [message_struct, None, ["", "", ""]]
    f_req = json.dumps([None, json.dumps(data)])

    # 构造请求
    import random
    query_params = {
        "bl": auth["bl"],
        "_reqid": random.randint(100000, 999999),
        "rt": "c",
    }

    model_header = MODEL_HEADERS.get(model, MODEL_HEADERS["gemini-3-flash"])

    headers = {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "X-Same-Domain": "1",
        "X-Goog-AuthUser": auth["auth_user"],
        "x-goog-ext-525001261-jspb": model_header,
        "Origin": "https://gemini.google.com",
        "Referer": "https://gemini.google.com/",
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }

    endpoint = f"https://gemini.google.com/u/{auth['auth_user']}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"

    print(f"[INFO] 发送分析请求 (模型: {model})...")
    t0 = time.time()

    resp = requests.post(
        endpoint,
        headers=headers,
        params=query_params,
        data={
            "at": auth["at"],
            "f.req": f_req,
        },
        stream=True,
        timeout=300,
    )

    if resp.status_code != 200:
        raise Exception(f"请求失败: HTTP {resp.status_code}")

    # 解析流式响应
    result = _parse_stream_response(resp)
    elapsed = time.time() - t0
    print(f"[OK] 分析完成 ({elapsed:.1f}s)")
    return result


# ========== Step 4: 解析响应 ==========
def _parse_stream_response(resp) -> dict:
    """
    解析 Gemini 流式响应
    格式: 每行可能是 )]}'\\n 前缀 + JSON 数组
    """
    final_result = None
    buffer = ""

    for chunk in resp.iter_content(chunk_size=8192, decode_unicode=True):
        if chunk is None:
            continue
        buffer += chunk

        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            parsed = _parse_gemini_line(line)
            if parsed:
                final_result = parsed
                # 实时输出文本
                sys.stdout.write(f"\r[INFO] 已接收 {len(parsed['text'])} 字符...")
                sys.stdout.flush()

    # 处理剩余
    if buffer.strip():
        parsed = _parse_gemini_line(buffer)
        if parsed:
            final_result = parsed

    if not final_result:
        raise Exception("未收到有效响应，可能 Cookie 已过期或模型不支持")

    print()  # 换行
    return final_result


def _parse_gemini_line(line: str) -> dict | None:
    """
    解析单行 Gemini 响应
    移植自 gemini-nexus 的 parser.js
    """
    try:
        # 去掉反劫持前缀
        clean = re.sub(r"^\)\]\}'", "", line).strip()
        if not clean:
            return None

        root_array = json.loads(clean)
        if not isinstance(root_array, list):
            return None

        for item in root_array:
            result = _extract_payload(item)
            if result:
                return result

    except (json.JSONDecodeError, Exception):
        pass
    return None


def _extract_payload(item) -> dict | None:
    """从响应项中提取文本和思考过程"""
    try:
        if not isinstance(item, list) or len(item) < 3:
            return None

        payload_str = item[2]
        if not isinstance(payload_str, str):
            return None

        payload = json.loads(payload_str)
        if not isinstance(payload, list) or len(payload) < 5:
            return None

        candidates = payload[4]
        if not isinstance(candidates, list) or not candidates or not candidates[0]:
            return None

        first = candidates[0]
        if not isinstance(first, list) or len(first) < 2:
            return None

        # 提取文本
        text = ""
        text_node = first[1]
        if isinstance(text_node, list) and text_node and isinstance(text_node[0], str):
            text = text_node[0]

        # 提取思考过程 (index 37)
        thoughts = None
        try:
            if (len(first) > 37 and first[37]
                and isinstance(first[37], list) and first[37][0]
                and isinstance(first[37][0], list)
                and isinstance(first[37][0][0], str)):
                thoughts = first[37][0][0]
        except (IndexError, TypeError):
            pass

        # 提取对话 ID
        conv_id = payload[1][0] if isinstance(payload[1], list) and payload[1] else None
        resp_id = payload[1][1] if isinstance(payload[1], list) and len(payload[1]) > 1 else None
        choice_id = first[0] if first else None

        return {
            "text": text,
            "thoughts": thoughts,
            "ids": [conv_id, resp_id, choice_id],
        }

    except (json.JSONDecodeError, IndexError, TypeError):
        return None


# ========== Cookie 工具 ==========
def load_cookie(cookie_file: str = None, cookie_str: str = None) -> str:
    """加载 Cookie"""
    if cookie_str:
        return cookie_str.strip()
    if cookie_file:
        with open(cookie_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    raise Exception("必须提供 --cookie 或 --cookie-file 参数")


# ========== 主流程 ==========
def main():
    parser = argparse.ArgumentParser(
        description="通过 Gemini 网页 API 分析视频（无需 API Key）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 使用 Cookie 文件
  python analyze_video_web.py video.mp4 --cookie-file cookie.txt

  # 直接传 Cookie 字符串
  python analyze_video_web.py video.mp4 --cookie "__Secure-1PSID=xxx; __Secure-1PSIDTS=xxx"

  # 指定模型和 Prompt
  python analyze_video_web.py video.mp4 --cookie-file cookie.txt --model gemini-3-pro --prompt "描述视频内容"
        """
    )
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("--cookie-file", "-f", help="Cookie 文件路径")
    parser.add_argument("--cookie", "-c", help="Cookie 字符串")
    parser.add_argument("--model", "-m", default="gemini-3-flash",
                        choices=list(MODEL_HEADERS.keys()), help="模型选择")
    parser.add_argument("--prompt", "-p", default=DEFAULT_PROMPT, help="分析提示词")
    parser.add_argument("--user-index", "-u", default="0", help="Google 账号索引")
    args = parser.parse_args()

    # 验证文件
    if not os.path.exists(args.video_path):
        print(f"[ERROR] 文件不存在: {args.video_path}")
        sys.exit(1)

    file_size_mb = os.path.getsize(args.video_path) / (1024 * 1024)
    if file_size_mb > 2048:
        print(f"[ERROR] 文件太大: {file_size_mb:.1f} MB (最大 2GB)")
        sys.exit(1)

    print(f"[INFO] 视频: {args.video_path} ({file_size_mb:.1f} MB)")
    print(f"[INFO] 模型: {args.model}")

    # 1. 加载 Cookie
    cookie = load_cookie(args.cookie_file, args.cookie)
    print(f"[OK] Cookie 加载成功 ({len(cookie)} 字符)")

    # 2. 获取认证参数
    auth = fetch_request_params(cookie, args.user_index)

    # 3. 上传视频
    file_id = upload_video(args.video_path, cookie)

    # 4. 发送分析请求
    result = send_message(
        prompt=args.prompt,
        file_id=file_id,
        file_name=os.path.basename(args.video_path),
        auth=auth,
        cookie=cookie,
        model=args.model,
    )

    # 5. 输出结果
    print(f"\n{'='*60}")
    print("VIDEO_ANALYSIS_RESULT")
    print(f"{'='*60}")
    print(result["text"])
    if result.get("thoughts"):
        print(f"\n{'='*60}")
        print("THINKING_PROCESS")
        print(f"{'='*60}")
        print(result["thoughts"])
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
