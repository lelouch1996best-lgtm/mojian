/**
 * 渲染进程全局类型声明：window.electronAPI 由 Electron preload 注入。
 * 仅在 Electron 环境下存在；普通浏览器访问时为 undefined。
 */

interface SerialSubmitResult {
  ok: boolean;
  error?: string;
}

interface ActivationStatus {
  activated: boolean;
}

interface Window {
  electronAPI?: {
    getMachineId: () => Promise<string>;
    getDisplayMachineId: () => Promise<string>;
    submitSerial: (serial: string) => Promise<SerialSubmitResult>;
    getActivationStatus: () => Promise<ActivationStatus>;
    onNavigateToMain: (cb: () => void) => () => void;
    activateReady: () => void;
  };
}
