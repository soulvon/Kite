/**
 * 存储的账号数据结构
 */
export interface StoredAccount {
  email: string;
  apiKey: string;
  apiServerUrl: string;
  name?: string;
  tag?: string;
  tags?: string[];
  disabled?: boolean;
  orgId?: string;
  /** Devin Auth1 原始 token（用于 Devin Automations 一键领$200 接口） */
  devinAuth1Token?: string;
}

/**
 * 登录结果
 */
export interface LoginResult {
  ok: boolean;
  error?: string;
  value?: StoredAccount;
}

/**
 * 配额快照
 */
export interface UsageSnapshot {
  name: string;
  email: string;
  planName: string;
  dailyRemainingPercent: number;
  weeklyRemainingPercent: number;
  dailyResetAtUnix: number;
  weeklyResetAtUnix: number;
  flexCredits: number;
  overageBalanceMicros?: number;
  planStart?: string;
  planEnd?: string;
  orgId?: string;
  _rawPlanStatus: any;
}

/**
 * Webview 消息类型
 */
export type WebviewMessageType =
  | 'loginSave'
  | 'switch'
  | 'delete'
  | 'fetchUsageFor'
  | 'runCommand'
  | 'openExternal'
  | 'batchLogin'
  | 'alertResponse'
  | 'addCurrent'
  | 'instanceList'
  | 'instanceCreate'
  | 'instanceDelete'
  | 'instanceStart'
  | 'instanceStop'
  | 'instanceFocus'
  | 'instanceUpdate'
  | 'cockpitList'
  | 'cockpitImport'
  | 'autoSwitchSettings'
  | 'refreshAllUsage'
  | 'batchTokenImport'
  | 'batchStoredAccountImport'
  | 'exportAccounts'
  | 'poolSignal'
  | 'batchDelete'
  | 'batchEnable'
  | 'batchDisable'
  | 'batchTag'
  | 'toggleDisabled'
  | 'updateTag'
  | 'getEnhancementStatus'
  | 'toggleEnhancement'
  | 'togglePreflightCheck'
  | 'playNotifySound'
  | 'browseAudioFile'
  | 'enhLoad'
  | 'enhSave'
  | 'enhCommand'
  | 'enhForceStop'
  | 'requestBridgeInfo'
  | 'getUsageStats'
  | 'savePoolTags'
  | 'getQuotaHistory'
  | 'openLogPanel'
  | 'syncRecoveryLogs'
  | 'syncDiagnoseLogs'
  | 'testModel'
  | 'testModelAll'
  | 'stopHealthCheck'
  | 'oauthLogin'
  | 'syncTagColors'
  | 'clearHealthRateLimit'
  | 'resetMachineId';

/**
 * Webview 消息
 */
export interface WebviewMessage {
  type: WebviewMessageType;
  email?: string;
  password?: string;
  apiKey?: string;
  apiServerUrl?: string;
  token?: string;
  authMethod?: 'auto' | 'auth1' | 'firebase';
  command?: string;
  url?: string;
  index?: number;
  batch?: boolean;
  level?: 'info' | 'warn' | 'error';
  modal?: boolean;
  title?: string;
  message?: string;
  instanceId?: string;
  instanceName?: string;
  cockpitId?: string;
  cockpitInstanceId?: string;
  id?: string;
  action?: string | null;
  emails?: string[];
  tag?: string;
  assignedTag?: string;
  settings?: Record<string, any>;
  payload?: Record<string, any>;
  force?: boolean;
}

/**
 * 后端发送给 Webview 的消息
 */
export type BackendMessageType =
  | 'usage'
  | 'accountsChanged'
  | 'batchResult'
  | 'instanceListResult'
  | 'instanceProgress'
  | 'instanceError'
  | 'cockpitListResult'
  | 'showAlert'
  | 'autoSwitchEvent'
  | 'autoSwitchSettingsSync'
  | 'preflightSettingSync'
  | 'audioFileSelected'
  | 'enhLoaded'
  | 'enhSaved'
  | 'enhCommandResult'
  | 'usageStatsSync'
  | 'testModelResult'
  | 'switchResult'
  | 'diagnosticSync'
  | 'oauthStatus';

export interface TestModelResultMessage {
  type: 'testModelResult';
  email: string;
  ok: boolean;
  reason?: string;
  status?: number;
  done?: boolean;       // true = this is the last result in a batch
  progress?: string;    // e.g. "3/10"
}

export interface UsageMessage {
  type: 'usage';
  email: string;
  snapshot: UsageSnapshot | null;
  error?: string;
}

export interface AccountsChangedMessage {
  type: 'accountsChanged';
  accounts: StoredAccount[];
  lastEmail: string;
  externalAccount?: string; // Windsurf 当前登录但不在号池中的账户邮箱
  lockedEmails?: string[];  // 被其他窗口占用的账号邮箱列表
  lockedEmailsMap?: Record<string, { instanceName: string }>; // 邮箱 → 占用实例名
}

export interface BatchResultMessage {
  type: 'batchResult';
  ok: boolean;
  email: string;
  error?: string;
}

export interface InstanceListResultMessage {
  type: 'instanceListResult';
  instances: any[];
  hasUnimported?: boolean;
}

export interface InstanceProgressMessage {
  type: 'instanceProgress';
  message: string;
  done?: boolean;
  error?: boolean;
}

export interface InstanceErrorMessage {
  type: 'instanceError';
  error: string;
}

export interface CockpitListResultMessage {
  type: 'cockpitListResult';
  instances: any[];
}

export interface ShowAlertMessage {
  type: 'showAlert';
  id?: string;
  title?: string;
  message: string;
  level?: 'info' | 'warn' | 'error';
  buttons?: string[];
}

export interface AutoSwitchEventMessage {
  type: 'autoSwitchEvent';
  log?: string;
  status?: string;
  statusType?: string;
}

export interface AutoSwitchSettingsSyncMessage {
  type: 'autoSwitchSettingsSync';
  enabled: boolean;
  threshold: number;
  checkSec: number;
  cooldownSec: number;
  refreshMin: number;
  refreshConcurrency: number;
  refreshBatchDelayMs: number;
  periodRefreshHours: number;
  scoreMode: string;
  switchStrategy: string;
  minQuota: number;
  preferUsedThreshold: number;
  poolScope: string;
  poolTag?: string;
}

export interface UsageStatsSyncMessage {
  type: 'usageStatsSync';
  totalSwitches: number;
  totalPoolSignals: number;
  totalRefreshes: number;
  avgDailyUsedPct: number;
  avgWeeklyUsedPct: number;
  totalDailyUsed: number;
  totalWeeklyUsed: number;
  accountCount: number;
  sessionStartTs: number;
  date: string;
  perAccount: Record<string, { switchToCount: number; dailyUsedPct: number; weeklyUsedPct: number; lastCheckTs: number }>;
}

export type BackendMessage = UsageMessage | AccountsChangedMessage | BatchResultMessage | InstanceListResultMessage | InstanceProgressMessage | InstanceErrorMessage | CockpitListResultMessage | ShowAlertMessage | AutoSwitchEventMessage | AutoSwitchSettingsSyncMessage | UsageStatsSyncMessage | TestModelResultMessage;

/**
 * 批量导入账号
 */
export interface BatchAccount {
  email: string;
  password: string;
}

/**
 * 批量导入结果
 */
export interface BatchResult {
  email: string;
  ok: boolean;
}

/**
 * Webview State 持久化数据
 */
export interface WebviewState {
  _usageCache?: Record<string, { snapshot: UsageSnapshot | null; error?: string; ts: number }>;
  _batchQueue?: BatchAccount[];
  _batchIndex?: number;
  _batchTotal?: number;
  _batchResults?: BatchResult[];
  autoSwitchEnabled?: boolean;
  autoSwitchThreshold?: number;
  allRefreshMin?: number;
  curRefreshMin?: number;
  isCardView?: boolean;
}
