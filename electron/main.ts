/**
 * Electron 主进程：启动 Next.js standalone 服务、注册激活门禁 IPC、创建应用窗口。
 *
 * 激活门禁流程：
 * - 启动时调用 isActivated() 判定：已激活 -> 加载主应用；未激活 -> 加载 /activate 激活页
 * - 渲染端激活页通过 window.electronAPI 调用 getMachineId / submitSerial
 * - submitSerial 验签通过后持久化激活记录并切换到主应用
 */

import { app, BrowserWindow, shell, ipcMain } from "electron";
import path from "path";
import net from "net";
import { spawn, type ChildProcess } from "child_process";
import { getMachineId, getDisplayMachineId } from "./machine-id";
import { saveActivation, isActivated } from "./activation-store";
import { verifyLicense } from "./license";

// 生产环境下前端与服务端共享的本地鉴权 token。
// - 服务端运行期读取 STORAGE_TOKEN（见 lib/auth.ts）
// - 前端构建期内联 NEXT_PUBLIC_STORAGE_TOKEN（见 package.json 的 electron:build:next 脚本）
// 二者必须一致，否则数据 API 返回 401。开发模式不设置该 token，lib/auth.ts 会自动放行。
const STORAGE_TOKEN = "mojian-electron-local-token";

// 开发模式固定端口，与 electron:dev 脚本中的 next dev / wait-on tcp:3000 对齐
const DEV_PORT = 3000;

let mainWindow: BrowserWindow | null = null;
let nextDevProcess: ChildProcess | null = null;
let currentPort = 0;

/** 检测端口是否已有服务在监听 */
function isPortTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(true))
      .once("listening", () => {
        tester.close(() => resolve(false));
      })
      .listen(port, "127.0.0.1");
  });
}

/** 从 start 起递增寻找一个空闲端口 */
async function findFreePort(start: number): Promise<number> {
  let port = start;
  while (port < start + 100) {
    if (!(await isPortTaken(port))) return port;
    port += 1;
  }
  throw new Error(`在 ${start}~${port} 范围内未找到可用端口`);
}

/** 轮询等待本地端口可连接 */
function waitForServer(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = new net.Socket();
      const onFail = () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`等待 Next 服务启动超时（端口 ${port}）`));
        } else {
          setTimeout(tryConnect, 300);
        }
      };
      socket
        .setTimeout(1000)
        .once("connect", () => {
          socket.destroy();
          resolve();
        })
        .once("error", onFail)
        .once("timeout", onFail)
        .connect(port, "127.0.0.1");
    };
    tryConnect();
  });
}

/**
 * 启动 Next 服务。
 * - 生产模式（app.isPackaged）：require 打包后的 standalone server.js
 * - 开发模式：若 electron:dev 脚本已启动 next dev（端口被占用）则直接复用；
 *   否则自行 spawn `next dev`（便于单独运行 electron 而不依赖 concurrently）。
 */
async function startNextServer(): Promise<number> {
  if (app.isPackaged) {
    // 生产模式：require Next standalone 产物（由 electron-builder 复制到 resources/app）
    // 注意：standalone 内含的 better-sqlite3 为原生模块，需由 @electron/rebuild
    // 针对 Electron ABI 重新构建（属构建流程另一任务）。
    const port = await findFreePort(3000);
    process.env.PORT = String(port);
    process.env.HOSTNAME = "127.0.0.1";
    const resourcesPath = (process as NodeJS.Process & {
      resourcesPath: string;
    }).resourcesPath;
    const serverPath = path.join(resourcesPath, "app", "server.js");
    require(serverPath);
    await waitForServer(port, 30000);
    return port;
  }

  // 开发模式
  const port = DEV_PORT;
  if (await isPortTaken(port)) {
    // electron:dev 脚本已通过 `next dev` 启动服务，直接复用，避免重复拉起
    return port;
  }
  // 独立运行时自行拉起 next dev
  nextDevProcess = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    shell: true,
    env: { ...process.env },
  });
  nextDevProcess.once("exit", (code) => {
    if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      console.error(`next dev 进程退出，退出码 ${code}`);
    }
  });
  await waitForServer(port, 60000);
  return port;
}

/** 主应用地址 */
function mainUrl(): string {
  return `http://localhost:${currentPort}/`;
}

/** 激活页地址 */
function activateUrl(): string {
  return `http://localhost:${currentPort}/activate`;
}

/**
 * 激活门禁判定：打包发布版（app.isPackaged）强制校验激活；
 * 开发模式（npm run electron:dev）跳过门禁直接进入主应用，方便开发者调试。
 */
function shouldRequireActivation(): boolean {
  return app.isPackaged;
}

/** 注册激活相关 IPC handler */
function registerActivationIpc(): void {
  // 返回本机机器指纹，供激活页展示并交给开发者签发绑定序列号
  ipcMain.handle("get-machine-id", () => getMachineId());
  // 返回分组展示用的机器码（便于用户抄录给开发者）
  ipcMain.handle("get-display-machine-id", () => getDisplayMachineId());

  // 查询当前激活状态（开发模式恒为已激活）
  ipcMain.handle("get-activation-status", () => ({
    activated: shouldRequireActivation() ? isActivated() : true,
  }));

  // 提交序列号：验签 -> 绑定机器 -> 持久化 -> 解锁主应用
  ipcMain.handle("submit-serial", (_event, serial: string) => {
    const result = verifyLicense(serial, getMachineId());
    if (!result.valid) {
      return { ok: false, error: result.error };
    }
    saveActivation(serial);
    // 激活成功，切换到主应用
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(mainUrl());
    }
    return { ok: true };
  });

  // 渲染端激活页就绪通知（预留）
  ipcMain.on("activate-ready", () => {
    /* no-op */
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#FFFBEB",
    webPreferences: {
      // preload.js 与 main.js 同处 dist-electron 目录（编译产物）
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 启动时根据激活状态决定初始页面：未激活则进入激活页（开发模式跳过门禁）
  const initialUrl =
    shouldRequireActivation() && !isActivated() ? activateUrl() : mainUrl();
  mainWindow.loadURL(initialUrl);

  // 窗口打开处理：站内链接（localhost）在应用内新窗口打开，站外链接用系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 站内相对路径或本机端口链接：在应用内打开新窗口，保留 Electron 体验
    if (url.startsWith("/") || url.startsWith(`http://localhost:${currentPort}`)) {
      return { action: "allow" };
    }
    // 站外链接：交给系统浏览器，避免应用内跳转离开
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 新开的子窗口继承主窗口的 preload 与安全设置
  app.on("browser-window-created", (_event, win) => {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("/") || url.startsWith(`http://localhost:${currentPort}`)) {
        return { action: "allow" };
      }
      shell.openExternal(url);
      return { action: "deny" };
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // 关键：数据库放到用户数据目录，避免被打包资源覆盖或丢失
  const userDataDir = app.getPath("userData");
  const dbPath = path.join(userDataDir, "data", "mojian.db");
  process.env.DB_PATH = dbPath;

  if (app.isPackaged) {
    // 生产模式：启用本地鉴权 token
    process.env.NODE_ENV = "production";
    process.env.STORAGE_TOKEN = STORAGE_TOKEN;
  }
  // 开发模式不设置 STORAGE_TOKEN，lib/auth.ts 在 development 下自动放行

  // 注册激活 IPC（须在窗口加载前完成）
  registerActivationIpc();

  try {
    currentPort = await startNextServer();
  } catch (err) {
    console.error("启动 Next 服务失败：", err);
    app.quit();
    return;
  }

  createWindow();
});

// macOS：点击 dock 图标时重新创建窗口
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && currentPort) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  // macOS 上应用保持活跃，其余平台退出
  if (process.platform !== "darwin") {
    cleanupAndQuit();
  }
});

app.on("before-quit", () => {
  cleanupDevProcess();
});

function cleanupDevProcess() {
  if (nextDevProcess) {
    try {
      nextDevProcess.kill();
    } catch {
      /* 忽略 */
    }
    nextDevProcess = null;
  }
}

function cleanupAndQuit() {
  cleanupDevProcess();
  app.quit();
}
