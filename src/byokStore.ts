import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import { ensureDir, getPoolRoot } from './utils';
import {
  ByokInjectedModel,
  ByokIdeModel,
  ByokModelMap,
  ByokModelSlot,
  ByokProvider,
  ByokProviderInput,
  ByokProviderPublic,
  ByokProviderTestResult,
  ByokSlotTarget,
} from './byokTypes';

const SECRET_PREFIX = 'windsurfPool.byok.provider.';

interface ProviderStoreFile {
  version: number;
  providers: ByokProvider[];
}

export function getByokRoot(): string {
  return path.join(getPoolRoot(), 'byok');
}

export function getByokRuntimeConfigDir(): string {
  return path.join(getByokRoot(), 'runtime');
}

function providersPath(): string {
  return path.join(getByokRoot(), 'providers.json');
}

function modelMapPath(): string {
  return path.join(getByokRoot(), 'model-map.json');
}

function ideModelsPath(): string {
  return path.join(getByokRoot(), 'ide-models.json');
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeId(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || `provider-${Date.now().toString(36)}`;
}

function normalizeHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeApiPath(apiPath: string | undefined, apiFormat: string): string {
  const fallback = apiFormat === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
  const raw = (apiPath || '').trim();
  if (!raw) return fallback;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function joinPathParts(basePath: string, endpointPath: string): string {
  const base = basePath && basePath !== '/' ? `/${basePath.replace(/^\/+|\/+$/g, '')}` : '';
  const endpoint = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  if (!base) return endpoint;
  if (endpoint === base || endpoint.startsWith(`${base}/`)) return endpoint;
  return `${base}${endpoint}`;
}

function normalizeEndpoint(host: string, apiPath: string | undefined, apiFormat: string): { apiHost: string; apiPath: string } {
  const normalizedHost = normalizeHost(host);
  const endpointPath = normalizeApiPath(apiPath, apiFormat);
  if (!normalizedHost) return { apiHost: '', apiPath: endpointPath };
  try {
    const url = new URL(normalizedHost);
    return {
      apiHost: url.origin,
      apiPath: joinPathParts(url.pathname, endpointPath),
    };
  } catch {
    return {
      apiHost: normalizedHost,
      apiPath: endpointPath,
    };
  }
}

function getModelsPath(apiPath: string | undefined): string {
  const pathValue = normalizeApiPath(apiPath, 'openai');
  const marker = '/v1/';
  const idx = pathValue.indexOf(marker);
  if (idx >= 0) return `${pathValue.slice(0, idx)}/v1/models`;
  if (pathValue.endsWith('/v1')) return `${pathValue}/models`;
  return '/v1/models';
}

function defaultModelMap(): ByokModelMap {
  return {
    namePrefix: 'BYOK',
    labelTemplate: '{prefix} {label} ({provider})',
    slots: [],
    injected: [],
  };
}

function normalizeSlotTargets(targets: ByokSlotTarget[] | undefined): ByokSlotTarget[] {
  const seen = new Set<string>();
  return (Array.isArray(targets) ? targets : [])
    .map(target => ({
      providerId: String(target?.providerId || '').trim(),
      model: String(target?.model || '').trim(),
    }))
    .filter(target => {
      const key = `${target.providerId}\n${target.model}`;
      if (!target.providerId || !target.model || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeInjectedModels(injected: ByokInjectedModel[] | undefined): ByokInjectedModel[] {
  const seen = new Set<string>();
  return (Array.isArray(injected) ? injected : [])
    .map(item => {
      const modelUid = String(item?.modelUid || '').trim();
      const label = String(item?.label || modelUid).trim();
      const providerId = String(item?.providerId || '').trim();
      const model = String(item?.model || '').trim();
      return {
        modelUid,
        label,
        providerId: providerId || undefined,
        model: model || undefined,
        supportsImages: item?.supportsImages !== undefined ? !!item.supportsImages : undefined,
        enabled: item?.enabled !== false,
      };
    })
    .filter(item => {
      if (!item.modelUid || seen.has(item.modelUid)) return false;
      seen.add(item.modelUid);
      return true;
    });
}

function maskKey(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function secretKey(context: vscode.ExtensionContext, provider: ByokProvider): Promise<string> {
  if (provider.secretRef) return provider.secretRef;
  return `${SECRET_PREFIX}${provider.id}`;
}

export async function readProviders(context: vscode.ExtensionContext, includeApiKey = false): Promise<ByokProvider[]> {
  ensureDir(getByokRoot());
  const file = readJson<ProviderStoreFile>(providersPath(), { version: 1, providers: [] });
  const providers = Array.isArray(file.providers) ? file.providers : [];
  if (!includeApiKey) return providers;
  const out: ByokProvider[] = [];
  for (const provider of providers) {
    const key = await context.secrets.get(await secretKey(context, provider));
    out.push({ ...provider, ...(key ? { apiKey: key } as any : {}) });
  }
  return out;
}

export async function readPublicProviders(context: vscode.ExtensionContext): Promise<ByokProviderPublic[]> {
  const providers = await readProviders(context, false);
  const out: ByokProviderPublic[] = [];
  for (const provider of providers) {
    const key = await context.secrets.get(await secretKey(context, provider));
    const { secretRef: _secretRef, ...publicProvider } = provider;
    out.push({
      ...publicProvider,
      hasApiKey: !!key,
      maskedApiKey: key ? maskKey(key) : undefined,
    });
  }
  return out;
}

async function writeProviders(providers: ByokProvider[]): Promise<void> {
  writeJson(providersPath(), { version: 1, providers });
}

export async function upsertProvider(context: vscode.ExtensionContext, input: ByokProviderInput): Promise<ByokProvider> {
  const providers = await readProviders(context, false);
  const id = input.id?.trim() || safeId(input.name || input.apiHost || 'provider');
  const idx = providers.findIndex(p => p.id === id);
  const existing = idx >= 0 ? providers[idx] : undefined;
  const apiFormat = input.apiFormat || existing?.apiFormat || 'openai';
  const endpoint = normalizeEndpoint(input.apiHost || existing?.apiHost || '', input.apiPath || existing?.apiPath, apiFormat);
  const now = nowIso();
  const inputModels = Array.isArray(input.models)
    ? [...new Set(input.models.map(m => String(m || '').trim()).filter(Boolean))]
    : undefined;
  const defaultModel = (input.defaultModel || inputModels?.[0] || existing?.defaultModel || '').trim();
  const provider: ByokProvider = {
    id,
    name: (input.name || existing?.name || id).trim(),
    apiFormat,
    apiHost: endpoint.apiHost,
    apiPath: endpoint.apiPath,
    defaultModel,
    enabled: input.enabled !== undefined ? !!input.enabled : existing?.enabled !== false,
    capabilities: existing?.capabilities || {},
    models: inputModels ? [...new Set([defaultModel, ...inputModels].filter(Boolean))] : (existing?.models || []),
    modelCaps: existing?.modelCaps || {},
    secretRef: existing?.secretRef || `${SECRET_PREFIX}${id}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (!provider.apiHost) throw new Error('请填写 API Host');
  if (!provider.defaultModel) throw new Error('请填写默认模型');
  if (idx >= 0) providers[idx] = provider;
  else providers.push(provider);
  if (input.apiKey && input.apiKey.trim()) {
    await context.secrets.store(provider.secretRef!, input.apiKey.trim());
  }
  await writeProviders(providers);
  return provider;
}

export async function deleteProvider(context: vscode.ExtensionContext, id: string): Promise<boolean> {
  const providers = await readProviders(context, false);
  const target = providers.find(p => p.id === id);
  if (!target) return false;
  await context.secrets.delete(await secretKey(context, target));
  await writeProviders(providers.filter(p => p.id !== id));
  const modelMap = readModelMap();
  let changed = false;
  for (const slot of modelMap.slots) {
    const before = slot.targets.length;
    slot.targets = slot.targets.filter(t => t.providerId !== id);
    changed = changed || before !== slot.targets.length;
  }
  for (const injected of modelMap.injected) {
    if (injected.providerId === id) {
      injected.providerId = undefined;
      changed = true;
    }
  }
  if (changed) writeModelMap(modelMap);
  return true;
}

export function readModelMap(): ByokModelMap {
  const raw = readJson<Partial<ByokModelMap>>(modelMapPath(), defaultModelMap());
  return {
    ...defaultModelMap(),
    ...raw,
    slots: Array.isArray(raw.slots) ? raw.slots : [],
    injected: Array.isArray(raw.injected) ? raw.injected : [],
  };
}

export function writeModelMap(modelMap: ByokModelMap): void {
  const normalized: ByokModelMap = {
    namePrefix: (modelMap.namePrefix || '').trim(),
    labelTemplate: (modelMap.labelTemplate || defaultModelMap().labelTemplate).trim(),
    slots: (Array.isArray(modelMap.slots) ? modelMap.slots : []).map(slot => ({
      modelUid: String(slot.modelUid || '').trim(),
      displayName: String(slot.displayName || '').trim(),
      supportsImages: slot.supportsImages !== undefined ? !!slot.supportsImages : undefined,
      enabled: slot.enabled !== false,
      targets: normalizeSlotTargets(slot.targets),
    })).filter(slot => !!slot.modelUid),
    injected: normalizeInjectedModels(modelMap.injected),
  };
  writeJson(modelMapPath(), normalized);
}

export function upsertModelSlot(input: Partial<ByokModelSlot> & { modelUid: string }): ByokModelSlot {
  const modelMap = readModelMap();
  const modelUid = input.modelUid.trim();
  if (!modelUid) throw new Error('请选择或填写 Windsurf 模型 UID');
  const idx = modelMap.slots.findIndex(s => s.modelUid === modelUid);
  const existing = idx >= 0 ? modelMap.slots[idx] : undefined;
  const targets = input.targets !== undefined
    ? normalizeSlotTargets(input.targets)
    : normalizeSlotTargets(existing?.targets);
  const slot: ByokModelSlot = {
    modelUid,
    displayName: (input.displayName || existing?.displayName || '').trim(),
    supportsImages: input.supportsImages !== undefined ? !!input.supportsImages : existing?.supportsImages,
    enabled: input.enabled !== undefined ? !!input.enabled : existing?.enabled !== false,
    targets,
  };
  if (idx >= 0) modelMap.slots[idx] = slot;
  else modelMap.slots.push(slot);
  writeModelMap(modelMap);
  return slot;
}

export function updateModelMapSettings(input: Partial<Pick<ByokModelMap, 'namePrefix' | 'labelTemplate'>>): ByokModelMap {
  const modelMap = readModelMap();
  const defaults = defaultModelMap();
  modelMap.namePrefix = String(input.namePrefix ?? modelMap.namePrefix ?? defaults.namePrefix).trim();
  modelMap.labelTemplate = String(input.labelTemplate ?? modelMap.labelTemplate ?? defaults.labelTemplate).trim()
    || defaults.labelTemplate;
  writeModelMap(modelMap);
  return readModelMap();
}

export function saveInjectedModels(injected: ByokInjectedModel[]): ByokModelMap {
  const modelMap = readModelMap();
  modelMap.injected = normalizeInjectedModels(injected);
  writeModelMap(modelMap);
  return readModelMap();
}

export function deleteModelSlot(modelUid: string): boolean {
  const modelMap = readModelMap();
  const before = modelMap.slots.length;
  modelMap.slots = modelMap.slots.filter(s => s.modelUid !== modelUid);
  const changed = modelMap.slots.length !== before;
  if (changed) writeModelMap(modelMap);
  return changed;
}

export function readIdeModels(): ByokIdeModel[] {
  const raw = readJson<{ models?: ByokIdeModel[] }>(ideModelsPath(), { models: [] });
  return Array.isArray(raw.models) ? raw.models : [];
}

export function syncCapturedIdeModelsFromRuntime(runtimeConfigDir: string): void {
  const src = path.join(runtimeConfigDir, 'ide-models.json');
  if (!fs.existsSync(src)) return;
  ensureDir(getByokRoot());
  fs.copyFileSync(src, ideModelsPath());
}

export async function writeRuntimeConfig(context: vscode.ExtensionContext, runtimeConfigDir = getByokRuntimeConfigDir()): Promise<void> {
  ensureDir(runtimeConfigDir);
  const providers = await readProviders(context, true);
  const runtimeProviders = [];
  for (const provider of providers) {
    const apiKey = (provider as any).apiKey || '';
    runtimeProviders.push({
      ...provider,
      apiKey,
    });
  }
  writeJson(path.join(runtimeConfigDir, 'providers.json'), { version: 1, providers: runtimeProviders });
  writeJson(path.join(runtimeConfigDir, 'model-map.json'), readModelMap());
  const captured = ideModelsPath();
  if (fs.existsSync(captured)) {
    fs.copyFileSync(captured, path.join(runtimeConfigDir, 'ide-models.json'));
  }
}

export function scrubRuntimeSecrets(runtimeConfigDir = getByokRuntimeConfigDir()): void {
  try {
    const file = path.join(runtimeConfigDir, 'providers.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

export async function testProvider(context: vscode.ExtensionContext, id: string, apiKeyOverride?: string): Promise<ByokProviderTestResult> {
  const providers = await readProviders(context, false);
  const provider = providers.find(p => p.id === id);
  if (!provider) return { ok: false, message: '供应商不存在' };
  const apiKey = (apiKeyOverride && apiKeyOverride.trim()) || await context.secrets.get(await secretKey(context, provider)) || '';
  if (!apiKey) return { ok: false, message: '请先保存 API Key' };
  const url = new URL(getModelsPath(provider.apiPath), provider.apiHost);
  const mod = url.protocol === 'http:' ? http : https;
  return new Promise<ByokProviderTestResult>((resolve) => {
    const req = mod.request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'User-Agent': 'windsurf-pool-byok',
      },
      timeout: 15_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) {
          let models: string[] = [];
          try {
            const json = JSON.parse(body);
            if (Array.isArray(json.data)) {
              models = json.data.map((m: any) => m && (m.id || m.name)).filter(Boolean).slice(0, 80);
            }
          } catch {
            // ignore non-json model lists
          }
          resolve({ ok: true, status, message: models.length ? `连接成功，读取到 ${models.length} 个模型` : '连接成功', models });
        } else {
          resolve({ ok: false, status, message: `连接失败：HTTP ${status}` });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, message: '连接超时' });
    });
    req.on('error', (err) => resolve({ ok: false, message: err.message }));
    req.end();
  });
}
