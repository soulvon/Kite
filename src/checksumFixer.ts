import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { writeFileWithElevation, copyFileWithElevation } from './elevatedFs';

/**
 * Checksum 修复器
 *
 * 原理：
 * VS Code/Electron 启动时会读 product.json 里的 checksums 字段，
 * 对其中列出的核心文件做 SHA256 校验，失败则弹"installation appears corrupt"通知。
 *
 * 我们修改了 workbench.html / extension.js 后，workbench.html 在 checksums 列表内，
 * 校验必然失败。本模块重算所有 checksums 项的真实哈希并写回 product.json，
 * 从根本消除"已损坏"提示。
 *
 * 算法与 VS Code 内置一致（见 vs/base/node/checksum.ts）：
 *   sha256 → base64 → 去掉末尾 = 填充
 */

export interface ChecksumFixResult {
  /** 实际修改的条目数 */
  fixed: number;
  /** checksums 总条目数 */
  total: number;
  /** 哈希已匹配、无需修改的条目数 */
  unchanged: number;
  /** 文件不存在的条目（路径） */
  missing: string[];
  /** 错误信息 */
  error?: string;
}

const PRODUCT_JSON = 'product.json';
const BACKUP_SUFFIX = '.origin';

/**
 * 计算单个文件的 base64 SHA256 哈希（去尾部 = 填充）
 */
function computeChecksum(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
  } catch {
    return null;
  }
}

function getProductJsonPath(): string {
  return path.join(vscode.env.appRoot, PRODUCT_JSON);
}

/**
 * 重算并修复 product.json 中的所有 checksums
 * @param dryRun 仅检测，不写入
 */
export function fixChecksums(dryRun = false): ChecksumFixResult {
  const result: ChecksumFixResult = { fixed: 0, total: 0, unchanged: 0, missing: [] };

  try {
    const productPath = getProductJsonPath();
    if (!fs.existsSync(productPath)) {
      result.error = 'product.json 不存在';
      return result;
    }

    const original = fs.readFileSync(productPath, 'utf8');
    let product: { checksums?: Record<string, string> };
    try {
      product = JSON.parse(original);
    } catch (e) {
      result.error = 'product.json 解析失败：' + (e instanceof Error ? e.message : String(e));
      return result;
    }

    const checksums = product.checksums;
    if (!checksums || typeof checksums !== 'object') {
      result.error = 'product.json 无 checksums 字段';
      return result;
    }

    // 用字符串替换保留原文件格式（Tab 缩进等），不重新 JSON.stringify
    let content = original;
    for (const [relPath, oldHash] of Object.entries(checksums)) {
      result.total++;
      const fullPath = path.join(vscode.env.appRoot, 'out', relPath);
      const newHash = computeChecksum(fullPath);

      if (!newHash) {
        result.missing.push(relPath);
        continue;
      }
      if (newHash === oldHash) {
        result.unchanged++;
        continue;
      }

      // 用 split/join 方式做精确替换，避免正则特殊字符问题
      const before = content;
      content = content.split(`"${oldHash}"`).join(`"${newHash}"`);
      if (content !== before) {
        result.fixed++;
      }
    }

    if (result.fixed > 0 && !dryRun) {
      // 备份原始（仅首次）
      const backupPath = productPath + BACKUP_SUFFIX;
      if (!fs.existsSync(backupPath)) {
        copyFileWithElevation(productPath, backupPath);
      }
      writeFileWithElevation(productPath, content, 'utf8');
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}

/**
 * 恢复 product.json 到首次修改前的备份
 */
export function restoreProductJson(): boolean {
  try {
    const productPath = getProductJsonPath();
    const backupPath = productPath + BACKUP_SUFFIX;
    if (!fs.existsSync(backupPath)) return false;
    copyFileWithElevation(backupPath, productPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 检测当前 product.json 是否需要修复（不写入）
 */
export function getChecksumStatus(): { needsFix: number; total: number; missing: number } {
  const r = fixChecksums(true);
  return { needsFix: r.fixed, total: r.total, missing: r.missing.length };
}
