#!/usr/bin/env node
/**
 * 视频分析脚本 - 使用 Gemini API
 * 用法: node analyze_video.js <视频路径> [提示词]
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ==================== 配置 ====================
const API_KEY = "sk-c23280dee3b14f4ca9c46b4b874f0de3";
const API_ENDPOINT = "http://127.0.0.1:8045";
const MODEL_NAME = "gemini-3-pro-high";
const DEFAULT_PROMPT = "请详细分析这个视频的创作流程、拍摄手法、剪辑技巧和内容要点。";

/**
 * 根据文件扩展名返回 MIME 类型
 */
function getVideoMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.flv': 'video/x-flv',
        '.3gp': 'video/3gpp',
        '.m4v': 'video/x-m4v',
    };
    return mimeTypes[ext] || 'video/mp4';
}

/**
 * 分析视频内容
 * @param {string} videoPath - 视频文件路径
 * @param {string} prompt - 分析提示词
 * @returns {Promise<string>} AI 分析结果
 */
async function analyzeVideo(videoPath, prompt = DEFAULT_PROMPT) {
    // 1. 检查视频文件
    if (!fs.existsSync(videoPath)) {
        throw new Error(`视频文件不存在: ${videoPath}`);
    }
    
    const stat = fs.statSync(videoPath);
    const fileSizeMB = (stat.size / (1024 * 1024)).toFixed(2);
    const fileName = path.basename(videoPath);
    
    console.log(`📹 视频文件: ${fileName}`);
    console.log(`📦 文件大小: ${fileSizeMB} MB`);
    
    // 2. 读取视频并转 Base64
    console.log('🔄 正在读取视频...');
    const videoBuffer = fs.readFileSync(videoPath);
    const base64Video = videoBuffer.toString('base64');
    const mimeType = getVideoMimeType(videoPath);
    
    console.log(`✅ 视频已编码 (MIME: ${mimeType})`);
    
    // 3. 初始化 Gemini API
    console.log(`🤖 调用模型: ${MODEL_NAME}`);
    console.log(`💬 提示词: ${prompt.substring(0, 50)}...`);
    
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel(
        { model: MODEL_NAME },
        {
            baseUrl: API_ENDPOINT,
            apiVersion: 'v1beta'
        }
    );
    
    // 4. 调用 API（与项目中的格式一致）
    const result = await model.generateContent({
        contents: [{
            role: 'user',
            parts: [
                {
                    inlineData: {
                        mimeType: mimeType,
                        data: base64Video
                    }
                },
                { text: prompt }
            ]
        }]
    });
    
    // 5. 返回结果
    return result.response.text();
}

/**
 * 命令行入口
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('用法: node analyze_video.js <视频路径> [提示词]');
        console.log('\n示例:');
        console.log('  node analyze_video.js video.mp4');
        console.log('  node analyze_video.js video.mp4 "分析这个视频的剪辑节奏"');
        process.exit(1);
    }
    
    const videoPath = args[0];
    const prompt = args[1] || DEFAULT_PROMPT;
    
    try {
        console.log('='.repeat(60));
        const result = await analyzeVideo(videoPath, prompt);
        console.log('='.repeat(60));
        console.log('\n📊 分析结果:\n');
        console.log(result);
        console.log('\n' + '='.repeat(60));
        
    } catch (error) {
        console.error(`❌ 错误: ${error.message}`);
        process.exit(1);
    }
}

// 运行主函数
if (require.main === module) {
    main();
}

module.exports = { analyzeVideo };
