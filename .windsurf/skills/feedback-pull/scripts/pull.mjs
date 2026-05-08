#!/usr/bin/env node
/**
 * 反馈拉取脚本
 * 从 Supabase 拉取 open 状态的反馈，下载附件，生成本地报告
 *
 * 使用: node .agent/skills/feedback-pull/scripts/pull.mjs
 * 前置: .env.local 中配置 SUPABASE_SERVICE_KEY
 *
 * 输出目录: feedback-data/（已在 .gitignore 中）
 * 防重复: 已拉取的 ID 记录在 feedback-data/.pulled-ids，不会重复下载
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { gunzipSync } from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');

// ─── 加载环境变量 ───────────────────────────────
function loadEnv(filename) {
    const envPath = join(PROJECT_ROOT, filename);
    if (!existsSync(envPath)) return {};
    const vars = {};
    readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
            vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
        }
    });
    return vars;
}

const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };
const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('❌ 缺少配置。请在 .env.local 中设置:');
    console.error('   SUPABASE_SERVICE_KEY=eyJ...');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ─── 已拉取 ID 管理 ──────────────────────────────
const OUTPUT_DIR = join(PROJECT_ROOT, 'feedback-data');
const PULLED_IDS_FILE = join(OUTPUT_DIR, '.pulled-ids');

function loadPulledIds() {
    if (!existsSync(PULLED_IDS_FILE)) return new Set();
    return new Set(
        readFileSync(PULLED_IDS_FILE, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean)
    );
}

function savePulledIds(ids) {
    writeFileSync(PULLED_IDS_FILE, [...ids].join('\n') + '\n');
}

// ─── 主流程 ────────────────────────────────────
async function main() {
    const today = new Date().toISOString().slice(0, 10);
    const attachDir = join(OUTPUT_DIR, 'attachments');
    mkdirSync(attachDir, { recursive: true });

    const pulledIds = loadPulledIds();
    console.log(`📋 已拉取过 ${pulledIds.size} 条反馈`);

    console.log('📥 查询 open 状态反馈...');

    const { data: feedbacks, error } = await supabase
        .from('feedback')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('❌ 拉取失败:', error.message);
        process.exit(1);
    }

    if (!feedbacks || feedbacks.length === 0) {
        console.log('✅ 没有未处理的反馈');
        process.exit(0);
    }

    // 过滤掉已拉取的
    const newFeedbacks = feedbacks.filter(fb => !pulledIds.has(fb.id));
    console.log(`📋 共 ${feedbacks.length} 条 open，其中 ${newFeedbacks.length} 条是新的`);

    if (newFeedbacks.length === 0) {
        console.log('✅ 没有新反馈');
        process.exit(0);
    }

    // 下载附件（仅新反馈）
    for (const fb of newFeedbacks) {
        const fbDir = join(attachDir, fb.id);
        mkdirSync(fbDir, { recursive: true });

        // 下载截图
        if (fb.screenshot_url) {
            try {
                const { data } = await supabase.storage
                    .from('feedback-attachments')
                    .download(fb.screenshot_url);
                if (data) {
                    const buffer = Buffer.from(await data.arrayBuffer());
                    writeFileSync(join(fbDir, 'screenshot.webp'), buffer);
                    console.log(`  📸 ${fb.id.slice(0, 8)}... 截图已下载`);
                }
            } catch {
                console.warn(`  ⚠️ ${fb.id.slice(0, 8)}... 截图下载失败`);
            }
        }

        // 下载并解压日志
        if (fb.log_archive_url) {
            try {
                const { data } = await supabase.storage
                    .from('feedback-attachments')
                    .download(fb.log_archive_url);
                if (data) {
                    const compressed = Buffer.from(await data.arrayBuffer());
                    const decompressed = gunzipSync(compressed);
                    const logsJson = JSON.parse(decompressed.toString('utf-8'));
                    writeFileSync(join(fbDir, 'logs.json'), JSON.stringify(logsJson, null, 2));
                    console.log(`  📄 ${fb.id.slice(0, 8)}... 日志已解压 (${Object.keys(logsJson).length} 个文件)`);
                }
            } catch {
                console.warn(`  ⚠️ ${fb.id.slice(0, 8)}... 日志下载/解压失败`);
            }
        }

        // 记录已拉取
        pulledIds.add(fb.id);
    }

    // 保存已拉取 ID
    savePulledIds(pulledIds);

    // 保存原始数据（所有 open 的，方便分析上下文）
    const rawPath = join(OUTPUT_DIR, `raw-${today}.json`);
    writeFileSync(rawPath, JSON.stringify(feedbacks, null, 2));
    console.log(`\n💾 原始数据已保存: ${rawPath}`);

    // 生成摘要报告
    const devices = new Set(feedbacks.map(fb => fb.device_id).filter(Boolean));
    const reportPath = join(OUTPUT_DIR, `report-${today}.md`);
    const report = `# 反馈拉取报告 — ${today}

| 统计 | 数量 |
|------|------|
| Open 反馈 | ${feedbacks.length} |
| 本次新增 | ${newFeedbacks.length} |
| 独立设备 | ${devices.size} |

## 反馈列表

${feedbacks.map((fb, i) => {
        const env = fb.os_info || {};
        const envStr = [env.os, env.gpu, env.ram].filter(Boolean).join(' | ');
        const isNew = newFeedbacks.some(nf => nf.id === fb.id);
        return `### ${i + 1}. ${isNew ? '🆕 ' : ''}${fb.description.slice(0, 60)}${fb.description.length > 60 ? '...' : ''}

- **ID**: \`${fb.id}\`
- **设备**: \`${fb.device_id?.slice(0, 12) || '未知'}...\`
- **版本**: ${fb.app_version || '未知'}
- **环境**: ${envStr || '未知'}
- **时间**: ${fb.created_at}
- **截图**: ${fb.screenshot_url ? '✅' : '❌'}
- **日志**: ${fb.log_archive_url ? '✅' : '❌'}

> ${fb.description}
`;
    }).join('\n')}

---
*⚠️ 待 AI 分类 — 请使用 SKILL.md 中 Step 2 的 prompt 进行分析*
`;

    writeFileSync(reportPath, report);
    console.log(`📝 报告已生成: ${reportPath}`);
    console.log('\n✅ 拉取完成！接下来请用 AI 分析 raw 数据进行分类。');
}

main().catch(err => {
    console.error('❌ 执行失败:', err);
    process.exit(1);
});
