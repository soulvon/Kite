"""
视频分析脚本 - 使用 google-generativeai SDK File API
用法: python analyze_video.py <video_path> [--api-key KEY] [--base-url URL] [--model MODEL] [--prompt PROMPT]
"""
import argparse
import sys
import time
import os

import google.generativeai as genai


DEFAULT_PROMPT = """请全面分析这个视频：
1. 内容概要：视频主题和主要内容
2. 关键场景：列出关键场景/片段及大致时间点
3. 视觉元素：重要的视觉元素（UI界面、文字、图形、人物等）
4. 语音内容：对话、旁白或重要音频内容摘要
5. 技术细节：视频质量、风格、转场等制作技巧
6. 核心要点：主要结论或关键信息
请用中文回复。"""


def main():
    parser = argparse.ArgumentParser(description="通过 Gemini File API 分析视频")
    parser.add_argument("video_path", help="视频文件路径")
    parser.add_argument("--api-key", "-k", required=True, help="API Key")
    parser.add_argument("--base-url", "-u", default="", help="代理 URL (如 yyds.215.im)")
    parser.add_argument("--model", "-m", default="gemini-3-flash-preview", help="模型")
    parser.add_argument("--prompt", "-p", default=DEFAULT_PROMPT, help="分析提示词")
    args = parser.parse_args()

    if not os.path.exists(args.video_path):
        print(f"[ERROR] 文件不存在: {args.video_path}")
        sys.exit(1)

    size_mb = os.path.getsize(args.video_path) / (1024 * 1024)
    print(f"[INFO] 视频: {args.video_path} ({size_mb:.1f} MB)")
    print(f"[INFO] 模型: {args.model}")

    # 配置 SDK
    config_kwargs = {"api_key": args.api_key}
    if args.base_url:
        host = args.base_url.replace("https://", "").replace("http://", "").rstrip("/")
        config_kwargs["client_options"] = {"api_endpoint": host}
        config_kwargs["transport"] = "rest"
        print(f"[INFO] 代理: {host}")
    genai.configure(**config_kwargs)

    # Step 1: 上传视频 (File API, 支持大文件分块上传)
    print(f"[INFO] 上传视频中...")
    t0 = time.time()
    video_file = genai.upload_file(args.video_path)
    print(f"[OK] 上传完成 ({time.time()-t0:.1f}s): {video_file.name}")

    # Step 2: 等待处理
    print(f"[INFO] 等待视频处理...", end="", flush=True)
    while video_file.state.name == "PROCESSING":
        print(".", end="", flush=True)
        time.sleep(5)
        video_file = genai.get_file(video_file.name)
    print()

    if video_file.state.name == "FAILED":
        print(f"[ERROR] 视频处理失败")
        sys.exit(1)

    print(f"[OK] 视频已就绪: {video_file.uri}")

    # Step 3: 发送分析请求
    print(f"[INFO] 分析中...")
    t0 = time.time()
    model = genai.GenerativeModel(args.model)
    response = model.generate_content([video_file, args.prompt])

    print(f"\n{'='*60}")
    print("VIDEO_ANALYSIS_RESULT")
    print(f"{'='*60}")
    print(response.text)
    print(f"{'='*60}")
    print(f"[OK] 完成 ({time.time()-t0:.1f}s)")


if __name__ == "__main__":
    main()
