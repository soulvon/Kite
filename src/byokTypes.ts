export type ByokApiFormat = 'openai' | 'anthropic';

export interface ByokProvider {
  id: string;
  name: string;
  apiFormat: ByokApiFormat;
  apiHost: string;
  apiPath?: string;
  defaultModel: string;
  enabled: boolean;
  capabilities?: Record<string, unknown>;
  models?: string[];
  modelCaps?: Record<string, Record<string, unknown>>;
  secretRef?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ByokProviderInput {
  id?: string;
  name?: string;
  apiFormat?: ByokApiFormat;
  apiHost?: string;
  apiPath?: string;
  defaultModel?: string;
  models?: string[];
  apiKey?: string;
  enabled?: boolean;
}

export interface ByokProviderPublic extends Omit<ByokProvider, 'secretRef'> {
  hasApiKey: boolean;
  maskedApiKey?: string;
}

export interface ByokSlotTarget {
  providerId: string;
  model: string;
}

export interface ByokModelSlot {
  modelUid: string;
  displayName?: string;
  supportsImages?: boolean;
  enabled: boolean;
  targets: ByokSlotTarget[];
}

export interface ByokInjectedModel {
  modelUid: string;
  label: string;
  providerId?: string;
  model?: string;
  supportsImages?: boolean;
  enabled?: boolean;
}

export interface ByokCatalogModel {
  modelUid: string;
  label: string;
  apiId?: string;
  contextWindow?: number;
  supportsImages?: boolean;
  noApiIdHint?: string;
}

export interface ByokModelMap {
  namePrefix: string;
  labelTemplate: string;
  slots: ByokModelSlot[];
  injected: ByokInjectedModel[];
}

export interface ByokIdeModel {
  modelUid: string;
  label: string;
}

export interface ByokRuntimeStats {
  startedAt?: string;
  uptimeSec?: number;
  requests?: number;
  errors?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estCostUsd?: number;
  lastProvider?: string;
  lastModel?: string;
  lastError?: string;
  retries?: number;
  lastRetries?: number;
  lastRetryReason?: string;
  rate?: Record<string, number>;
  byModel?: Record<string, unknown>;
  recent?: unknown[];
}

export interface ByokProviderTestResult {
  ok: boolean;
  message: string;
  status?: number;
  models?: string[];
}

export interface ByokPatchStatus {
  targetPath?: string;
  exists: boolean;
  patchedApi: boolean;
  patchedRestart: boolean;
  patchedInference: boolean;
  backupPath?: string;
  backupExists: boolean;
  details: string[];
}

export interface ByokRuntimeState {
  running: boolean;
  processId?: number;
  apiPort: number;
  inferencePort: number;
  configDir: string;
  runtimeDir: string;
  providers: ByokProviderPublic[];
  modelMap: ByokModelMap;
  ideModels: ByokIdeModel[];
  catalog: ByokCatalogModel[];
  stats?: ByokRuntimeStats | null;
  patch: ByokPatchStatus;
  logs: string[];
}
