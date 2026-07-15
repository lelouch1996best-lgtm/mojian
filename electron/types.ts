/**
 * Electron 预注入到渲染进程的 API 类型定义。
 * 由 preload.ts 通过 contextBridge.exposeInMainWorld('electronAPI', ...) 实现。
 * 激活门禁相关 IPC 的 handler 在主进程 main.ts 中注册。
 */

/** 激活提交结果 */
export interface SerialSubmitResult {
  ok: boolean;
  error?: string;
}

/** 激活状态查询结果 */
export interface ActivationStatus {
  activated: boolean;
}

/** 暴露在 window.electronAPI 上的接口 */
export interface ElectronAPI {
  /** 获取本机完整机器指纹（hex），用于绑定序列号 */
  getMachineId: () => Promise<string>;
  /** 获取供展示的机器码（每 4 位分组，便于阅读抄录） */
  getDisplayMachineId: () => Promise<string>;
  /** 提交序列号进行激活校验 */
  submitSerial: (serial: string) => Promise<SerialSubmitResult>;
  /** 查询当前激活状态 */
  getActivationStatus: () => Promise<ActivationStatus>;
  /** 监听主进程「激活完成，可进入主应用」通知，返回取消订阅函数 */
  onNavigateToMain: (cb: () => void) => () => void;
  /** 通知主进程渲染端已就绪 */
  activateReady: () => void;
}
