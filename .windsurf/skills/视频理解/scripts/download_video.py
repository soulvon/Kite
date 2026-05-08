#!/usr/bin/env python3
"""
视频下载工具 - 使用 yt-dlp 从 URL 下载视频
用法: python download_video.py <url> [--output-dir <dir>] [--max-height <720>]
"""
import subprocess
import sys
import os
import tempfile
import argparse


def check_ytdlp():
    """检查 yt-dlp 是否已安装"""
    try:
        subprocess.run(["yt-dlp", "--version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def install_ytdlp():
    """安装 yt-dlp"""
    print("[INFO] yt-dlp 未安装，正在安装...")
    subprocess.run([sys.executable, "-m", "pip", "install", "yt-dlp"], check=True)
    print("[INFO] yt-dlp 安装完成")


def download_video(url, output_dir=None, max_height=720):
    """
    下载视频到指定目录
    返回下载后的文件绝对路径
    """
    if not check_ytdlp():
        install_ytdlp()

    if output_dir is None:
        output_dir = os.path.join(tempfile.gettempdir(), "video_analysis")
    os.makedirs(output_dir, exist_ok=True)

    output_template = os.path.join(output_dir, "%(title).80s.%(ext)s")

    cmd = [
        "yt-dlp",
        "-f", f"bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]",
        "--merge-output-format", "mp4",
        "-o", output_template,
        "--no-playlist",
        "--print", "after_move:filepath",
        url
    ]

    print(f"[INFO] 开始下载: {url}")
    print(f"[INFO] 输出目录: {output_dir}")
    print(f"[INFO] 最大分辨率: {max_height}p")

    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")

    if result.returncode != 0:
        print(f"[ERROR] 下载失败: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    # 最后一行是文件路径
    filepath = result.stdout.strip().split('\n')[-1]
    filepath = os.path.abspath(filepath)

    file_size_mb = os.path.getsize(filepath) / (1024 * 1024)
    print(f"[OK] 下载完成: {filepath}")
    print(f"[OK] 文件大小: {file_size_mb:.1f} MB")

    return filepath


def main():
    parser = argparse.ArgumentParser(description="下载视频（使用 yt-dlp）")
    parser.add_argument("url", help="视频 URL")
    parser.add_argument("--output-dir", "-o", default=None, help="输出目录，默认系统临时目录")
    parser.add_argument("--max-height", "-m", type=int, default=720, help="最大分辨率高度，默认 720")
    args = parser.parse_args()

    filepath = download_video(args.url, args.output_dir, args.max_height)
    # 最终输出文件路径，供调用方获取
    print(f"\nFILE_PATH={filepath}")


if __name__ == "__main__":
    main()
