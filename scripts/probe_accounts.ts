/**
 * 命令行测活脚本 - 测试指定标签的账号
 *
 * 用法：
 *   node scripts/probe_accounts.js --tag <标签名> [--model <模型ID>] [--parallel <并发数>]
 *   node scripts/probe_accounts.js --email <邮箱> [--model <模型ID>]
 *   node scripts/probe_accounts.js --all [--model <模型ID>] [--parallel <并发数>]
 *
 * 示例：
 *   node scripts/probe_accounts.js --tag prod
 *   node scripts/probe_accounts.js --email user@example.com
 *   node scripts/probe_accounts.js --all --parallel 3
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── 跨平台工具函数 ──

function getAppDataDir(): string {
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA;
    if (!appdata) { throw new Error('APPDATA 环境变量不存在'); }
    return appdata;
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getPoolRoot(): string {
  return path.join(getAppDataDir(), '.windsurf-pool');
}

// ── 账号数据结构 ──

// StoredAccount 结构
// email, apiKey, apiServerUrl, name?, tag?, tags?, disabled?

// ── 读取账号文件 ──

function readAccounts() {
  const accountsPath = path.join(getPoolRoot(), 'accounts.json');
  if (!fs.existsSync(accountsPath)) {
    console.error(`❌ 账号文件不存在: ${accountsPath}`);
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(accountsPath, 'utf8');
    const accounts = JSON.parse(raw);
    if (!Array.isArray(accounts)) {
      console.error('❌ 账号文件格式错误：应为数组');
      process.exit(1);
    }
    return accounts;
  } catch (e: any) {
    console.error(`❌ 读取账号文件失败: ${e.message}`);
    process.exit(1);
  }
}

// ── 筛选账号 ──

function filterAccounts(accounts, options) {
  if (options.email) {
    const account = accounts.find(a => a.email === options.email);
    if (!account) {
      console.error(`❌ 未找到邮箱为 ${options.email} 的账号`);
      process.exit(1);
    }
    if (account.disabled) {
      console.error(`❌ 账号 ${options.email} 已禁用`);
      process.exit(1);
    }
    return [account];
  }

  if (options.tag) {
    const filtered = accounts.filter(a => !a.disabled && (a.tag === options.tag || a.tags?.includes(options.tag!)));
    if (filtered.length === 0) {
      console.error(`❌ 未找到标签为 ${options.tag} 的账号`);
      process.exit(1);
    }
    return filtered;
  }

  if (options.all) {
    const filtered = accounts.filter(a => !a.disabled);
    if (filtered.length === 0) {
      console.error('❌ 没有可用的账号');
      process.exit(1);
    }
    return filtered;
  }

  console.error('❌ 请指定 --tag、--email 或 --all');
  process.exit(1);
}

// ── Cascade Probe（简化版，不依赖扩展上下文） ──

async function cascadeProbeSimple(apiKey, modelUid = 'MODEL_SWE_1_5') {
  // 直接 require 编译后的 JS（CommonJS）
  const compiledPath = path.join(process.cwd(), 'out', 'cascadeProbe.js');

  if (!fs.existsSync(compiledPath)) {
    return { rateLimited: false, error: 'cascadeProbe.js 未编译，请先运行 npx tsc' };
  }

  try {
    // CommonJS require
    const module = require(compiledPath);
    const cascadeProbe = module.cascadeProbe;
    if (typeof cascadeProbe !== 'function') {
      return { rateLimited: false, error: 'cascadeProbe 函数未导出' };
    }
    return await cascadeProbe(apiKey, modelUid, true);
  } catch (e) {
    return { rateLimited: false, error: `Probe 失败: ${e.message}` };
  }
}

// ── 并发测活 ──

async function probeAccounts(accounts, modelUid, concurrency) {
  console.log(`\n📋 开始测活 ${accounts.length} 个账号（并发: ${concurrency}，模型: ${modelUid}）\n`);

  let success = 0;
  let rateLimited = 0;
  let failed = 0;
  const results = [];

  // 分批执行
  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (account) => {
        const result = await cascadeProbeSimple(account.apiKey, modelUid);
        return { account, result };
      })
    );

    results.push(...batchResults);

    // 输出批次结果
    for (const { account, result } of batchResults) {
      const tagDisplay = account.tags?.join(',') || account.tag || '-';
      const nameDisplay = account.name || account.email;

      if (result.rateLimited) {
        console.log(`🔴 ${nameDisplay} [${tagDisplay}] - 限速 (${result.limitKind || 'unknown'})`);
        if (result.resetText) console.log(`   重置时间: ${result.resetText}`);
        if (result.traceId) console.log(`   Trace ID: ${result.traceId}`);
        rateLimited++;
      } else if (result.error) {
        console.log(`⚠️  ${nameDisplay} [${tagDisplay}] - 失败: ${result.error}`);
        failed++;
      } else {
        console.log(`🟢 ${nameDisplay} [${tagDisplay}] - 可用`);
        if (result.reply) console.log(`   回复: ${result.reply.slice(0, 50)}...`);
        success++;
      }
    }

    // 显示进度
    const progress = Math.min(i + concurrency, accounts.length);
    console.log(`\n进度: ${progress}/${accounts.length} (成功: ${success}, 限速: ${rateLimited}, 失败: ${failed})\n`);
  }

  // 汇总
  console.log('\n' + '='.repeat(60));
  console.log(`📊 测活完成`);
  console.log(`   总计: ${accounts.length}`);
  console.log(`   可用: ${success} (${Math.round(success / accounts.length * 100)}%)`);
  console.log(`   限速: ${rateLimited} (${Math.round(rateLimited / accounts.length * 100)}%)`);
  console.log(`   失败: ${failed} (${Math.round(failed / accounts.length * 100)}%)`);
  console.log('='.repeat(60));
}

// ── 命令行参数解析 ──

function parseArgs(): { tag?: string; email?: string; all?: boolean; model?: string; parallel?: number } {
  const args = process.argv.slice(2);
  const result: { tag?: string; email?: string; all?: boolean; model?: string; parallel?: number } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tag' && args[i + 1]) {
      result.tag = args[++i];
    } else if (arg === '--email' && args[i + 1]) {
      result.email = args[++i];
    } else if (arg === '--all') {
      result.all = true;
    } else if (arg === '--model' && args[i + 1]) {
      result.model = args[++i];
    } else if (arg === '--parallel' && args[i + 1]) {
      result.parallel = parseInt(args[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
命令行测活脚本 - 测试指定标签的账号

用法：
  node scripts/probe_accounts.ts --tag <标签名> [--model <模型ID>] [--parallel <并发数>]
  node scripts/probe_accounts.ts --email <邮箱> [--model <模型ID>]
  node scripts/probe_accounts.ts --all [--model <模型ID>] [--parallel <并发数>]

参数：
  --tag <标签名>       测试指定标签的所有账号
  --email <邮箱>       测试指定邮箱的账号
  --all                测试所有可用账号
  --model <模型ID>     指定模型（默认: MODEL_SWE_1_5）
  --parallel <并发数>  并发测活数量（默认: 1）
  --help, -h           显示帮助信息

示例：
  node scripts/probe_accounts.ts --tag prod
  node scripts/probe_accounts.ts --email user@example.com
  node scripts/probe_accounts.ts --all --parallel 3
  node scripts/probe_accounts.ts --tag test --model MODEL_SWE_1_6 --parallel 2
`);
      process.exit(0);
    }
  }

  return result;
}

// ── 主函数 ──

async function main(): Promise<void> {
  const options = parseArgs();

  if (!options.tag && !options.email && !options.all) {
    console.error('❌ 请指定 --tag、--email 或 --all（使用 --help 查看帮助）');
    process.exit(1);
  }

  const modelUid = options.model || 'MODEL_SWE_1_5';
  const concurrency = options.parallel || 1;

  const accounts = readAccounts();
  const filtered = filterAccounts(accounts, options);

  await probeAccounts(filtered, modelUid, concurrency);
}

main().catch((e) => {
  console.error('❌ 未捕获的错误:', e);
  process.exit(1);
});
