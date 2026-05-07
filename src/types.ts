/**
 * 存储的账号数据结构
 */
export interface StoredAccount {
  email: string;
  apiKey: string;
  apiServerUrl: string;
  name?: string;
  tag?: string;
  disabled?: boolean;
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
  | 'poolSignal'
  | 'batchDelete'
  | 'batchEnable'
  | 'batchDisable'
  | 'batchTag'
  | 'toggleDisabled'
  | 'updateTag'
  | 'getEnhancementStatus'
  | 'toggleEnhancement'
  | 'playNotifySound'
  | 'browseAudioFile';

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
  | 'audioFileSelected';

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
  scoreMode: string;
}

export type BackendMessage = UsageMessage | AccountsChangedMessage | BatchResultMessage | InstanceListResultMessage | InstanceProgressMessage | InstanceErrorMessage | CockpitListResultMessage | ShowAlertMessage | AutoSwitchEventMessage | AutoSwitchSettingsSyncMessage;

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
