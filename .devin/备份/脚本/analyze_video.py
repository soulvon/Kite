#!/usr/bin/env python3
"""
视频分析脚本 - 使用 Gemini API
用法: python analyze_video.py <视频路径> [提示词]
"""

import sys
import base64
from pathlib import Path
import google.generativeai as genai

# ==================== 配置 ====================
API_KEY = "sk-c23280dee3b14f4ca9c46b4b874f0de3"
API_ENDPOINT = "http://127.0.0.1:8045"
MODEL_NAME = "gemini-3-pro-high"
DEFAULT_PROMPT = "请详细分析这个视频的创作流程、拍摄手法、剪辑技巧和内容要点。"

# ==================== 初始化 ====================
genai.configure(
    api_key=API_KEY,
    transport='rest',
    client_options={'api_endpoint': API_ENDPOINT}
)

def get_video_mime_type(file_path: str) -> str:
    """根据文件扩展名返回 MIME 类型"""
    ext = Path(file_path).suffix.lower()
    mime_types = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.flv': 'video/x-flv',
        '.3gp': 'video/3gpp',
        '.m4v': 'video/x-m4v',
    }
    return mime_types.get(ext, 'video/mp4')

def analyze_video(video_path: str, prompt: str = DEFAULT_PROMPT) -> str:
    """
    分析视频内容
    
    Args:
        video_path: 视频文件路径
        prompt: 分析提示词
        
    Returns:
        str: AI 分析结果
    """
    # 1. 检查视频文件
    video_file = Path(video_path)
    if not video_file.exists():
        raise FileNotFoundError(f"视频文件不存在: {video_path}")
    
    file_size_mb = video_file.stat().st_size / (1024 * 1024)
    print(f"📹 视频文件: {video_file.name}")
    print(f"📦 文件大小: {file_size_mb:.2f} MB")
    
    # 2. 读取视频并转 Base64
    print("🔄 正在读取视频...")
    with open(video_path, 'rb') as f:
        video_bytes = f.read()
    
    base64_video = base64.b64encode(video_bytes).decode('utf-8')
    mime_type = get_video_mime_type(video_path)
    
    print(f"✅ 视频已编码 (MIME: {mime_type})")
    
    # 3. 调用 Gemini API
    print(f"🤖 调用模型: {MODEL_NAME}")
    print(f"💬 提示词: {prompt[:50]}...")
    
    model = genai.GenerativeModel(MODEL_NAME)
    
    # 构建请求（与项目中的格式一致）
    response = model.generate_content([
        {
            "mime_type": mime_type,
            "data": base64_video
        },
        prompt
    ])
    
    # 4. 返回结果
    return response.text

def main():
    """命令行入口"""
    if len(sys.argv) < 2:
        print("用法: python analyze_video.py <视频路径> [提示词]")
        print(f"\n示例:")
        print(f"  python analyze_video.py video.mp4")
        print(f"  python analyze_video.py video.mp4 '分析这个视频的剪辑节奏'")
        sys.exit(1)
    
    video_path = sys.argv[1]
    prompt = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_PROMPT
    
    try:
        print("=" * 60)
        result = analyze_video(video_path, prompt)
        print("=" * 60)
        print("\n📊 分析结果:\n")
        print(result)
        print("\n" + "=" * 60)
        
    except Exception as e:
        print(f"❌ 错误: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
