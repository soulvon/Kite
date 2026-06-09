import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { copyFileWithElevation, writeFileWithElevation } from './elevatedFs';
import { ByokPatchStatus } from './byokTypes';

const API_ORIGIN_RE = 'https?:\\/\\/(?:localhost|127\\.0\\.0\\.1):\\d+';

function backupPath(targetPath: string): string {
  return `${targetPath}.byok-origin`;
}

function readText(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function isLikelyTarget(file: string): boolean {
  try {
    const text = readText(file);
    return text.includes('getApiServerUrlFromContext') && text.includes('INFERENCE_API_SERVER_URL');
  } catch {
    return false;
  }
}

function walkForExtensionJs(root: string, depth: number, out: string[]): void {
  if (depth < 0 || !fs.existsSync(root)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkForExtensionJs(full, depth - 1, out);
    } else if (entry.isFile() && entry.name === 'extension.js') {
      out.push(full);
    }
  }
}

export function findWindsurfExtensionJsPath(): string | undefined {
  const roots = [
    path.join(vscode.env.appRoot, 'extensions', 'windsurf'),
    path.join(vscode.env.appRoot, 'extensions'),
  ];
  const direct: string[] = [];
  for (const root of roots) {
    direct.push(
      path.join(root, 'dist', 'extension.js'),
      path.join(root, 'out', 'extension.js'),
      path.join(root, 'build', 'extension.js'),
      path.join(root, 'extension.js')
    );
  }
  const candidates: string[] = [];
  for (const file of direct) {
    if (fs.existsSync(file)) candidates.push(file);
  }
  for (const root of roots) {
    walkForExtensionJs(root, 3, candidates);
  }
  return candidates.find(isLikelyTarget);
}

export function getByokPatchStatus(apiPort = 7450, inferencePort = 7451): ByokPatchStatus {
  const targetPath = findWindsurfExtensionJsPath();
  const status: ByokPatchStatus = {
    targetPath,
    exists: !!targetPath,
    patchedApi: false,
    patchedRestart: false,
    patchedInference: false,
    backupPath: targetPath ? backupPath(targetPath) : undefined,
    backupExists: targetPath ? fs.existsSync(backupPath(targetPath)) : false,
    details: [],
  };
  if (!targetPath) {
    status.details.push('未找到 Windsurf 内置扩展 extension.js');
    return status;
  }
  try {
    const text = readText(targetPath);
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const apiUrlLocalhost = `http://localhost:${apiPort}`;
    const inferenceUrl = `http://127.0.0.1:${inferencePort}`;
    const inferenceUrlLocalhost = `http://localhost:${inferencePort}`;
    status.patchedApi = text.includes(`return"${apiUrl}"`) || text.includes(`return"${apiUrlLocalhost}"`);
    status.patchedRestart = text.includes(`="${apiUrl}",this.apiServerUrl=`) || text.includes(`="${apiUrlLocalhost}",this.apiServerUrl=`);
    status.patchedInference = text.includes(`="${inferenceUrl}"`) || text.includes(`="${inferenceUrlLocalhost}"`);
    if (status.patchedApi) status.details.push('API Server 已指向本地 sidecar');
    if (status.patchedRestart) status.details.push('Language Server restart 已锁定本地 sidecar');
    if (status.patchedInference) status.details.push('Inference Server 已指向本地 sidecar');
    if (text.includes('return"http://localhost:3000"') || text.includes('="http://localhost:3000",this.apiServerUrl=') || text.includes('="http://localhost:3001"')) {
      status.details.push('检测到旧 Proxy Manager patch，需要重新应用 BYOK patch 切到当前端口');
    }
  } catch (err) {
    status.details.push(`读取 patch 状态失败：${err instanceof Error ? err.message : String(err)}`);
  }
  return status;
}

export function applyByokPatch(apiPort = 7450, inferencePort = 7451): ByokPatchStatus {
  const targetPath = findWindsurfExtensionJsPath();
  if (!targetPath) throw new Error('未找到 Windsurf 内置扩展 extension.js');
  let text = readText(targetPath);
  const original = text;
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const inferenceUrl = `http://127.0.0.1:${inferencePort}`;
  const details: string[] = [];

  const apiExact = 'e.getApiServerUrlFromContext=A=>{if((0,g.getConfig)(g.Config.API_SERVER_URL)!==n.DEFAULT_API_SERVER_URL)return(0,g.getConfig)(g.Config.API_SERVER_URL);const t=(0,e.isStaging)((0,g.getConfig)(g.Config.API_SERVER_URL))?"apiServerUrl.staging":"apiServerUrl",i=A.globalState.get(t);return void 0===i||(0,e.isStaging)(i)?(0,g.getConfig)(g.Config.API_SERVER_URL):i}';
  if (text.includes(apiExact)) {
    text = text.replace(apiExact, `e.getApiServerUrlFromContext=A=>{return"${apiUrl}"}`);
    details.push('已 patch getApiServerUrlFromContext');
  } else {
    const alreadyApi = new RegExp(`([A-Za-z_$][\\w$]*\\.getApiServerUrlFromContext=)([A-Za-z_$][\\w$]*)=>\\{return"${API_ORIGIN_RE}"\\}`);
    if (alreadyApi.test(text)) {
      text = text.replace(alreadyApi, `$1$2=>{return"${apiUrl}"}`);
      details.push('已更新 API Server 本地端口');
    } else if (text.includes(`return"${apiUrl}"`)) {
      details.push('API Server patch 已存在');
    } else {
      details.push('未找到 getApiServerUrlFromContext 精确锚点');
    }
  }

  const restartExact = 'async restart(A){this.apiServerUrl=A,this.inputs.apiServerUrl=A,';
  if (text.includes(restartExact)) {
    text = text.replace(restartExact, `async restart(A){A="${apiUrl}",this.apiServerUrl=A,this.inputs.apiServerUrl=A,`);
    details.push('已 patch language server restart');
  } else {
    const restartAlready = new RegExp(`async restart\\(([A-Za-z_$][\\w$]*)\\)\\{\\1="${API_ORIGIN_RE}",this\\.apiServerUrl=\\1,this\\.inputs\\.apiServerUrl=\\1,`);
    const restartGeneric = /async restart\(([A-Za-z_$][\w$]*)\)\{this\.apiServerUrl=\1,this\.inputs\.apiServerUrl=\1,/;
    if (restartAlready.test(text)) {
      text = text.replace(restartAlready, `async restart($1){$1="${apiUrl}",this.apiServerUrl=$1,this.inputs.apiServerUrl=$1,`);
      details.push('已更新 language server restart 本地端口');
    } else if (restartGeneric.test(text)) {
      text = text.replace(restartGeneric, `async restart($1){$1="${apiUrl}",this.apiServerUrl=$1,this.inputs.apiServerUrl=$1,`);
      details.push('已 patch language server restart');
    } else {
      details.push('未找到 language server restart 锚点');
    }
  }

  const inferenceExact = 'const i=(0,w.getConfig)(w.Config.INFERENCE_API_SERVER_URL)';
  if (text.includes(inferenceExact)) {
    text = text.replace(inferenceExact, `const i="${inferenceUrl}"`);
    details.push('已 patch inference api server');
  } else {
    const inferenceGeneric = /const ([A-Za-z_$][\w$]*)=\(0,([A-Za-z_$][\w$]*)\.getConfig\)\(\2\.Config\.INFERENCE_API_SERVER_URL\)/;
    const legacyInference = /const ([A-Za-z_$][\w$]*)="http:\/\/localhost:3001"/;
    if (inferenceGeneric.test(text)) {
      text = text.replace(inferenceGeneric, `const $1="${inferenceUrl}"`);
      details.push('已 patch inference api server');
    } else if (legacyInference.test(text)) {
      text = text.replace(legacyInference, `const $1="${inferenceUrl}"`);
      details.push('已从旧 Proxy Manager inference 端口切到 BYOK');
    } else if (text.includes(`="${inferenceUrl}"`)) {
      details.push('Inference patch 已存在');
    } else {
      details.push('未找到 inference api server 锚点');
    }
  }

  if (text !== original) {
    const bak = backupPath(targetPath);
    if (!fs.existsSync(bak)) copyFileWithElevation(targetPath, bak);
    writeFileWithElevation(targetPath, text, 'utf8');
  } else {
    const status = getByokPatchStatus(apiPort, inferencePort);
    if (!status.patchedApi && !status.patchedRestart && !status.patchedInference) {
      throw new Error(details.join('；'));
    }
  }

  const status = getByokPatchStatus(apiPort, inferencePort);
  status.details.unshift(...details);
  return status;
}

export function restoreByokPatch(): ByokPatchStatus {
  const targetPath = findWindsurfExtensionJsPath();
  if (!targetPath) throw new Error('未找到 Windsurf 内置扩展 extension.js');
  const bak = backupPath(targetPath);
  if (!fs.existsSync(bak)) throw new Error('未找到 BYOK patch 备份文件');
  copyFileWithElevation(bak, targetPath);
  const status = getByokPatchStatus();
  status.details.unshift('已从 BYOK 备份恢复 extension.js');
  return status;
}
