import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "./types";

const api: ElectronAPI = {
  getMachineId: () => ipcRenderer.invoke("get-machine-id"),
  getDisplayMachineId: () => ipcRenderer.invoke("get-display-machine-id"),
  submitSerial: (serial) => ipcRenderer.invoke("submit-serial", serial),
  getActivationStatus: () => ipcRenderer.invoke("get-activation-status"),
  onNavigateToMain: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("navigate-to-main", handler);
    return () => {
      ipcRenderer.removeListener("navigate-to-main", handler);
    };
  },
  activateReady: () => {
    ipcRenderer.send("activate-ready");
  },
};

// 将安全接口注入渲染进程的 window.electronAPI
contextBridge.exposeInMainWorld("electronAPI", api);
