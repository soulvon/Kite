/**
 * 全局配置常量
 */

// 缓存 TTL（毫秒）
export const CACHE_TTL = {
  ACCOUNTS: 1000,      // 账号列表缓存 1s
  INSTANCES: 1000,    // 实例列表缓存 1s
  COCKPIT: 5000,      // Cockpit 实例缓存 5s
  BIND_MARK: 10000,   // 绑定标记缓存 10s
  PROCESS: 5000,      // 进程检测缓存 5s
  EXE_PATH: 60000,    // exe 路径检测缓存 60s
} as const;

// Firebase API Key
export const FIREBASE_API_KEY = 'AIzaSyDsOl-1XpT5err0Tcnx8FFod1H8gVGIycY';
