/**
 * 视频分析脚本 - 使用 Gemini File API 上传 + generateContent 分析
 * 大文件先通过 File API 上传，再引用 fileUri 发送给模型
 * 用法: npx tsx analyze_video.ts <video_path> [--base-url <url>] [--api-key <key>] [--model <model>] [--prompt <prompt>]
 */
import { GoogleGenerativeAI, FileState } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import * as fs from "fs";
import * as path from "path";

// --- 参数解析 ---
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

const videoPath = args.find(a => !a.startsWith("--")) || "";
const baseUrl = getArg("base-url", "");
const apiKey = getArg("api-key", "");
const modelId = getArg("model", "gemini-3-flash-preview");
const customPrompt = getArg("prompt", "");

const DEFAULT_PROMPT = `请全面分析这个视频：
1. 内容概要：视频主题和主要内容
2. 关键场景：列出关键场景/片段及大致时间点
3. 视觉元素：重要的视觉元素（UI界面、文字、图形、人物等）
4. 语音内容：对话、旁白或重要音频内容摘要
5. 技术细节：视频质量、风格、转场等制作技巧
6. 核心要点：主要结论或关键信息
请用中文回复。`;

// --- MIME 类型映射 ---
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mpeg": "video/mpeg", ".mpg": "video/mpeg", ".wmv": "video/x-ms-wmv",
    ".avi": "video/x-msvideo",
  };
  return map[ext] || "video/mp4";
}

// --- 等待文件处理完成 ---
async function waitForFileActive(fileManager: GoogleAIFileManager, fileName: string): Promise<void> {
  console.log(`[INFO] 等待文件处理完成...`);
  let file = await fileManager.getFile(fileName);
  while (file.state === FileState.PROCESSING) {
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 3000));
    file = await fileManager.getFile(fileName);
  }
  console.log("");
  if (file.state === FileState.FAILED) {
    throw new Error(`文件处理失败: ${file.name}`);
  }
  console.log(`[OK] 文件已就绪: ${file.displayName} (${file.uri})`);
}

// --- 主流程 ---
async function main() {
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error(`[ERROR] 视频文件不存在: ${videoPath}`);
    console.error(`用法: npx tsx analyze_video.ts <video_path> --api-key <key> [--base-url <url>] [--model <model>]`);
    process.exit(1);
  }

  if (!apiKey) {
    console.error(`[ERROR] 缺少 API Key，请通过 --api-key 参数提供`);
    process.exit(1);
  }

  const fileSizeMB = fs.statSync(videoPath).size / (1024 * 1024);
  const mimeType = getMimeType(videoPath);
  console.log(`[INFO] 视频文件: ${videoPath}`);
  console.log(`[INFO] 文件大小: ${fileSizeMB.toFixed(1)} MB`);
  console.log(`[INFO] MIME类型: ${mimeType}`);
  console.log(`[INFO] 模型: ${modelId}`);
  console.log(`[INFO] API: ${baseUrl || "Google 官方"}`);

  // --- 方式选择 ---
  // 文件 > 15MB 或指定了 baseUrl 且非 Google 官方 → 尝试 File API
  // 文件 ≤ 15MB 且无代理限制 → 直接 inlineData
  const isProxy = baseUrl && !baseUrl.includes("googleapis");
  const useFileAPI = fileSizeMB > 15 || !isProxy;

  const requestOptions = baseUrl ? {
    baseUrl: baseUrl,
    apiVersion: "v1beta" as const,
  } : undefined;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId }, requestOptions);
  const prompt = customPrompt || DEFAULT_PROMPT;

  let contentParts: any[];

  if (useFileAPI && !isProxy) {
    // === File API 方式（适用于 Google 官方 API Key） ===
    console.log(`[INFO] 使用 File API 上传视频...`);
    const fileManager = new GoogleAIFileManager(apiKey);

    const uploadResult = await fileManager.uploadFile(videoPath, {
      mimeType: mimeType,
      displayName: path.basename(videoPath),
    });

    console.log(`[OK] 文件上传成功: ${uploadResult.file.displayName}`);
    console.log(`[INFO] URI: ${uploadResult.file.uri}`);

    // 等待文件处理完成
    await waitForFileActive(fileManager, uploadResult.file.name);

    contentParts = [
      { fileData: { mimeType: mimeType, fileUri: uploadResult.file.uri } },
      { text: prompt },
    ];
  } else {
    // === InlineData 方式（适用于代理或小文件） ===
    console.log(`[INFO] 使用 inlineData 方式传输视频...`);
    const videoData = fs.readFileSync(videoPath);
    const base64Data = videoData.toString("base64");
    console.log(`[INFO] Base64 大小: ${(base64Data.length / (1024 * 1024)).toFixed(1)} MB`);

    contentParts = [
      { inlineData: { mimeType: mimeType, data: base64Data } },
      { text: prompt },
    ];
  }

  console.log(`[INFO] 发送分析请求...`);
  const startTime = Date.now();

  try {
    const result = await model.generateContentStream({
      contents: [{ role: "user", parts: contentParts }],
    });

    let fullText = "";
    process.stdout.write("\n===== 视频分析结果 =====\n\n");
    for await (const chunk of result.stream) {
      const candidates = (chunk as any).candidates;
      if (candidates?.length > 0) {
        for (const candidate of candidates) {
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) {
                fullText += part.text;
                process.stdout.write(part.text);
              }
            }
          }
        }
      } else {
        const text = chunk.text();
        if (text) {
          fullText += text;
          process.stdout.write(text);
        }
      }
    }

    process.stdout.write("\n\n===== 分析完成 =====\n");
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[OK] 用时: ${elapsed}s, 输出: ${fullText.length} 字符`);
  } catch (e: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n[ERROR] 分析失败 (${elapsed}s): ${e.message}`);
    if (e.message?.includes("413") || e.message?.includes("Too Large")) {
      console.error(`[HINT] 文件太大，代理服务器拒绝。请使用 Google 官方 API Key 或更小的视频。`);
    }
    process.exit(1);
  }
}

main();
