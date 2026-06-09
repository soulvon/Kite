import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import {
  ByokCatalogModel,
  ByokInjectedModel,
  ByokModelSlot,
  ByokProviderInput,
  ByokProviderTestResult,
  ByokRuntimeState,
  ByokRuntimeStats,
} from './byokTypes';
import {
  deleteModelSlot,
  deleteProvider,
  getByokRoot,
  getByokRuntimeConfigDir,
  readIdeModels,
  readModelMap,
  readPublicProviders,
  scrubRuntimeSecrets,
  saveInjectedModels,
  syncCapturedIdeModelsFromRuntime,
  testProvider,
  updateModelMapSettings,
  upsertModelSlot,
  upsertProvider,
  writeRuntimeConfig,
} from './byokStore';
import { applyByokPatch, getByokPatchStatus, restoreByokPatch } from './byokIdePatch';

export class ByokProxyManager implements vscode.Disposable {
  private _child?: ChildProcessWithoutNullStreams;
  private _logs: string[] = [];
  private _disposed = false;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  private readonly _onDidLog = new vscode.EventEmitter<string>();
  readonly onDidChange = this._onDidChange.event;
  readonly onDidLog = this._onDidLog.event;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  get apiPort(): number {
    return vscode.workspace.getConfiguration('windsurfPool.byok').get<number>('apiPort', 7450);
  }

  get inferencePort(): number {
    return vscode.workspace.getConfiguration('windsurfPool.byok').get<number>('inferencePort', 7451);
  }

  get runtimeDir(): string {
    return path.join(this._context.globalStorageUri.fsPath, 'byok-runtime');
  }

  get configDir(): string {
    return getByokRuntimeConfigDir();
  }

  private get resourceDir(): string {
    return path.join(this._context.extensionPath, 'resources', 'byok-sidecar');
  }

  private log(line: string): void {
    const text = `[${new Date().toLocaleTimeString()}] ${line}`;
    this._logs.push(text);
    if (this._logs.length > 200) this._logs.splice(0, this._logs.length - 200);
    if (!this._disposed) this._onDidLog.fire(text);
  }

  private fireChange(): void {
    if (!this._disposed) this._onDidChange.fire();
  }

  private copyDir(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDir(from, to);
      } else if (entry.isFile()) {
        fs.copyFileSync(from, to);
      }
    }
  }

  private prepareRuntime(): void {
    if (!fs.existsSync(this.resourceDir)) {
      throw new Error(`BYOK sidecar 资源不存在：${this.resourceDir}`);
    }
    this.copyDir(this.resourceDir, this.runtimeDir);
    fs.mkdirSync(getByokRoot(), { recursive: true });
    fs.mkdirSync(this.configDir, { recursive: true });
  }

  private async waitForReady(timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: this.apiPort,
          path: '/__byok/stats',
          method: 'GET',
          timeout: 500,
        }, (res) => {
          res.resume();
          resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 500);
        });
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
        req.on('error', () => resolve(false));
        req.end();
      });
      if (ok) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`BYOK sidecar 启动超时（端口 ${this.apiPort} 未响应）`);
  }

  private readCatalog(): ByokCatalogModel[] {
    try {
      const file = path.join(this.resourceDir, 'windsurf-catalog.json');
      if (!fs.existsSync(file)) return [];
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const models = Array.isArray(raw?.models) ? raw.models : [];
      return models
        .map((item: any) => ({
          modelUid: String(item?.modelUid || '').trim(),
          label: String(item?.label || item?.modelUid || '').trim(),
          apiId: item?.apiId ? String(item.apiId).trim() : undefined,
          contextWindow: Number.isFinite(item?.contextWindow) ? Number(item.contextWindow) : undefined,
          supportsImages: item?.supportsImages !== undefined ? !!item.supportsImages : undefined,
          noApiIdHint: item?.noApiIdHint ? String(item.noApiIdHint) : undefined,
        }))
        .filter((item: ByokCatalogModel) => item.modelUid && item.label);
    } catch (err) {
      this.log(`读取扩展槽位目录失败：${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private async readStats(): Promise<ByokRuntimeStats | null> {
    if (!this._child || this._child.killed) return null;
    return new Promise<ByokRuntimeStats | null>((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.apiPort,
        path: '/__byok/stats',
        method: 'GET',
        timeout: 800,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as ByokRuntimeStats);
          } catch {
            resolve(null);
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  }

  async start(): Promise<void> {
    if (this._child && !this._child.killed) {
      this.log('sidecar 已在运行');
      return;
    }
    this.prepareRuntime();
    await writeRuntimeConfig(this._context, this.configDir);
    const nodePath = vscode.workspace.getConfiguration('windsurfPool.byok').get<string>('nodePath', 'node') || 'node';
    const env = {
      ...process.env,
      BYOK_CONFIG_DIR: this.configDir,
      BYOK_RESOURCE_DIR: this.runtimeDir,
      BYOK_BIND_HOST: '127.0.0.1',
      API_PORT: String(this.apiPort),
      INFERENCE_PORT: String(this.inferencePort),
      BYOK_MITM_LOG: 'false',
    };
    this.log(`启动 sidecar：${nodePath} proxy-entry.js (${this.apiPort}/${this.inferencePort})`);
    const child = spawn(nodePath, ['proxy-entry.js'], {
      cwd: this.runtimeDir,
      env,
      windowsHide: true,
    });
    this._child = child;
    child.stdout.on('data', (chunk: Buffer) => this.log(chunk.toString('utf8').trim()));
    child.stderr.on('data', (chunk: Buffer) => this.log(chunk.toString('utf8').trim()));
    child.on('exit', (code, signal) => {
      this.log(`sidecar 已退出 code=${code ?? '-'} signal=${signal ?? '-'}`);
      if (this._child === child) this._child = undefined;
      try { syncCapturedIdeModelsFromRuntime(this.configDir); } catch {}
      try { scrubRuntimeSecrets(this.configDir); } catch {}
      this.fireChange();
    });
    child.on('error', (err) => {
      this.log(`sidecar 启动失败：${err.message}`);
      this.fireChange();
    });
    await this.waitForReady();
    this.log('sidecar 已就绪');
    this.fireChange();
  }

  async stop(): Promise<void> {
    const child = this._child;
    if (!child) {
      scrubRuntimeSecrets(this.configDir);
      this.fireChange();
      return;
    }
    this.log('停止 sidecar');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        resolve();
      }, 1200);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try { child.kill(); } catch { resolve(); }
    });
    this._child = undefined;
    try { syncCapturedIdeModelsFromRuntime(this.configDir); } catch {}
    scrubRuntimeSecrets(this.configDir);
    this.fireChange();
  }

  async saveProvider(input: ByokProviderInput): Promise<void> {
    await upsertProvider(this._context, input);
    if (this._child) await writeRuntimeConfig(this._context, this.configDir);
    this.fireChange();
  }

  async deleteProvider(id: string): Promise<void> {
    await deleteProvider(this._context, id);
    if (this._child) await writeRuntimeConfig(this._context, this.configDir);
    this.fireChange();
  }

  async testProvider(id: string, apiKeyOverride?: string): Promise<ByokProviderTestResult> {
    return testProvider(this._context, id, apiKeyOverride);
  }

  async saveSlot(slot: Partial<ByokModelSlot> & { modelUid: string }): Promise<void> {
    upsertModelSlot(slot);
    if (this._child) await writeRuntimeConfig(this._context, this.configDir);
    this.fireChange();
  }

  async saveModelMapSettings(settings: { namePrefix?: string; labelTemplate?: string }): Promise<void> {
    updateModelMapSettings(settings);
    if (this._child) await writeRuntimeConfig(this._context, this.configDir);
    this.fireChange();
  }

  async saveInjectedModels(injected: ByokInjectedModel[]): Promise<void> {
    saveInjectedModels(injected);
    if (this._child) await writeRuntimeConfig(this._context, this.configDir);
    this.fireChange();
  }

  async deleteSlot(modelUid: string): Promise<void> {
    deleteModelSlot(modelUid);
    if (this._child) await writeRuntimeConfig(this._context, this.configDir);
    this.fireChange();
  }

  async applyPatch(): Promise<void> {
    applyByokPatch(this.apiPort, this.inferencePort);
    this.fireChange();
  }

  async restorePatch(): Promise<void> {
    restoreByokPatch();
    this.fireChange();
  }

  async getState(): Promise<ByokRuntimeState> {
    return {
      running: !!this._child && !this._child.killed,
      processId: this._child?.pid,
      apiPort: this.apiPort,
      inferencePort: this.inferencePort,
      configDir: this.configDir,
      runtimeDir: this.runtimeDir,
      providers: await readPublicProviders(this._context),
      modelMap: readModelMap(),
      ideModels: readIdeModels(),
      catalog: this.readCatalog(),
      stats: await this.readStats(),
      patch: getByokPatchStatus(this.apiPort, this.inferencePort),
      logs: this._logs.slice(-80),
    };
  }

  dispose(): void {
    this._disposed = true;
    void this.stop();
    this._onDidChange.dispose();
    this._onDidLog.dispose();
  }
}
