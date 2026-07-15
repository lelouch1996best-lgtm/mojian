# Tasks

- [x] Task 1: Electron 外壳与 Next.js standalone 服务集成
  - [x] SubTask 1.1: 修改 `next.config.mjs` 启用 `output: 'standalone'`
  - [x] SubTask 1.2: 新增 `electron/main.ts` 主进程：创建 BrowserWindow、启动 standalone Next 服务、加载本地端口
  - [x] SubTask 1.3: 新增 `electron/preload.ts` 通过 contextBridge 暴露激活相关 IPC API
  - [x] SubTask 1.4: 配置 `package.json` 增加 electron 依赖与 `electron:dev` / `electron:build` 脚本
  - [ ] SubTask 1.5: 验证开发模式下 Electron 窗口能正常加载 Next.js 页面与 API 路由（延至 Task 9 端到端验证）

- [x] Task 2: 机器指纹生成
  - [x] SubTask 2.1: 新增 `electron/machine-id.ts`，跨平台采集硬件信息（macOS ioreg / Windows WMIC 或 reg / Linux machine-id）生成稳定机器码
  - [x] SubTask 2.2: 通过 preload 暴露 `getMachineId` IPC 供激活页调用

- [x] Task 3: Ed25519 序列号签名与验证
  - [x] SubTask 3.1: 定义序列号 payload 结构（产品 ID / 机器指纹 / 适用主版本号 / 签发时间 / 过期时间(0=永久) / tier）
  - [x] SubTask 3.2: 新增 `electron/license.ts` 实现公钥验签 + 字段校验（产品、主版本号、过期、机器指纹）逻辑；读取 App 自身主版本号参与比对
  - [x] SubTask 3.3: 生成 Ed25519 密钥对，公钥放入 `electron/keys/public.pem`，私钥路径写入 `.gitignore` 不入库
  - [x] SubTask 3.4: 实现序列号格式化（可读分组格式）与解析

- [x] Task 4: 激活记录安全存储
  - [x] SubTask 4.1: 使用 Electron `safeStorage` 加密激活记录并写入 `app.getPath('userData')`
  - [x] SubTask 4.2: 实现读取 / 校验 / 清除激活记录的函数（验签 + 过期 + 机器指纹）

- [x] Task 5: 激活门禁与主流程
  - [x] SubTask 5.1: 主进程启动时检查激活状态，决定加载激活页或主应用 URL
  - [x] SubTask 5.2: 实现 `submitSerial` IPC：验签 -> 校验主版本号 -> 绑定机器 -> 存储记录 -> 解锁主应用
  - [x] SubTask 5.3: 启动时校验已存记录（签名 / 主版本号 / 过期 / 机器指纹），任一失效则清除并回到激活页

- [x] Task 6: 激活页 UI
  - [x] SubTask 6.1: 新增 `app/activate/page.tsx`，展示机器码、序列号输入框、激活按钮、错误提示
  - [x] SubTask 6.2: 复用现有暖色设计系统（brand/slate 色阶、Noto 字体），激活成功后通知主进程切换到主应用

- [x] Task 7: 序列号生成工具（开发者侧）
  - [x] SubTask 7.1: 新增 `tools/gen-license.ts`，读取私钥、按参数（机器指纹或通配符、主版本号、有效期或永久、tier）生成签发序列号
  - [x] SubTask 7.2: 在 `package.json` 增加 `gen:license` 脚本并在 README 或脚本帮助中说明使用方式

- [x] Task 8: electron-builder 打包配置
  - [x] SubTask 8.1: 新增 `electron-builder.yml`，配置 macOS(dmg) / Windows(nsis) / Linux(AppImage) 产物
  - [x] SubTask 8.2: 配置将 Next.js standalone 产物与 public/ 静态资源打入 resources
  - [x] SubTask 8.3: 配置 `@electron/rebuild` 在构建前针对 Electron ABI 重编译 better-sqlite3，并设置 asarUnpack 处理原生 .node 文件

- [x] Task 9: 端到端验证
  - [x] SubTask 9.1: 用生成工具签发测试序列号，验证激活 / 启动 / 失效（过期、换机、跨主版本、篡改）全流程（真实代码走通 8 项用例）
  - [ ] SubTask 9.2: 打包 macOS 安装包，安装后走完激活流程并正常使用主应用功能（受沙箱限制，需在开发者本机 `npm run electron:build` 后实测）

# Task Dependencies
- Task 2 依赖 Task 1（需要 Electron 主进程与 preload 环境）
- Task 4 依赖 Task 3（存储记录依赖验签与 payload 结构）
- Task 5 依赖 Task 2、Task 3、Task 4
- Task 6 依赖 Task 5（需要激活 IPC 就绪）
- Task 7 依赖 Task 3（生成与验证需对齐 payload 与序列号格式）
- Task 8 依赖 Task 1（需要 standalone 产物）
- Task 9 依赖 Task 1-8 全部完成
