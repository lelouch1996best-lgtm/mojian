# 桌面客户端打包与序列号激活 Spec

## Why
墨间目前是一个需要 `npm run dev` / `npm start` 才能运行的 Next.js Web 应用，普通用户无法直接安装使用。需要将其打包为可直接安装的桌面客户端，并通过序列号激活机制控制使用授权，防止未授权分发与多机共用。

## What Changes
- 引入 Electron 作为桌面客户端外壳，以 standalone 模式内嵌运行现有 Next.js 应用，保留服务端 API 路由、better-sqlite3、COS SDK 等服务端能力
- 新增序列号激活系统：基于 Ed25519 离线签名验证，App 内嵌公钥本地验签，无需 license 服务器
- 新增版本作用域控制：序列号绑定主版本号，同一主版本（如 1.x）共用一个序列号，跨主版本（如升级到 2.x）需换新序列号
- 新增有效期可控：由开发者决定每个序列号为永久有效或限时有效
- 新增机器指纹绑定：激活时绑定本机硬件指纹，防止同一序列号在多台机器上使用
- 新增激活门禁：未激活时仅显示激活页，激活后才能进入主应用
- 新增激活信息安全存储：使用 Electron safeStorage（OS 级加密）保存激活记录
- 新增序列号生成工具（开发者侧，使用私钥离线签发）
- 配置 electron-builder 产出 macOS / Windows / Linux 安装包
- **BREAKING**：分发形态从「源码 + npm 脚本」变为「安装包」，构建与分发流程改变

## Impact
- Affected specs: 无（首次建立桌面客户端与授权能力）
- Affected code:
  - `next.config.mjs`（启用 standalone 输出）
  - `package.json`（新增 electron / electron-builder / @electron/rebuild 依赖与构建脚本）
  - 新增 `electron/` 目录（主进程、preload、机器指纹、序列号验证、激活存储、Next 服务启动）
  - 新增 `app/activate/page.tsx`（激活页 UI）
  - 新增 `tools/gen-license.ts`（序列号生成工具）
  - 新增 `electron-builder.yml`（打包配置）
  - 新增 `electron/keys/public.pem`（公钥内嵌；私钥不入库，写入 .gitignore）

## ADDED Requirements

### Requirement: Electron 桌面客户端打包
系统 SHALL 将现有 Next.js 应用打包为可通过安装程序安装并运行的桌面客户端，在 macOS、Windows、Linux 上均提供原生安装包。

#### Scenario: 用户安装并启动客户端
- **WHEN** 用户在目标操作系统上运行安装包并完成安装后启动应用
- **THEN** 应用以独立桌面窗口启动，内嵌运行 Next.js 服务端，UI 正常加载
- **AND** 服务端 API 路由（LLM / 图片 / 视频 / COS / 数据 CRUD）正常工作
- **AND** better-sqlite3 数据库在用户数据目录正常初始化

#### Scenario: 原生模块兼容
- **WHEN** 构建桌面客户端
- **THEN** better-sqlite3 针对 Electron 的 Node ABI 重新编译
- **AND** 打包后原生模块随安装包正确分发并在运行时可加载

### Requirement: 序列号离线验证
系统 SHALL 使用 Ed25519 非对称签名对序列号进行离线验证，App 内嵌公钥，私钥由开发者离线保管，无需联网或 license 服务器。

#### Scenario: 合法序列号验证通过
- **WHEN** 用户输入由开发者用私钥签发的合法序列号
- **THEN** App 用内嵌公钥验签通过
- **AND** 校验产品 ID 匹配、主版本号与 App 当前主版本一致、未过期、机器指纹匹配（或为通配符）
- **AND** 激活成功，解锁应用

#### Scenario: 伪造序列号验证失败
- **WHEN** 用户输入未经私钥签名的伪造序列号
- **THEN** 公钥验签失败
- **AND** 激活被拒绝，提示序列号无效

#### Scenario: 序列号过期
- **WHEN** 用户输入已超过有效期的限时序列号
- **THEN** 激活被拒绝，提示序列号已过期

#### Scenario: 永久序列号不过期
- **WHEN** 用户输入开发者签发为永久有效（无过期时间）的序列号
- **THEN** 不进行过期校验，只要签名、版本、机器指纹有效即放行

### Requirement: 版本作用域控制
系统 SHALL 在序列号 payload 中编码其适用的主版本号，App 读取自身版本的主版本号进行比对，同一主版本下的所有小版本/补丁版本共用同一序列号，跨主版本升级时要求重新激活。

#### Scenario: 同主版本小版本升级无需换号
- **WHEN** 用户已在 v1.2.0 激活，随后升级到 v1.2.3（同属主版本 1）
- **THEN** 启动时校验序列号主版本号 1 与 App 主版本号 1 一致
- **AND** 激活记录仍然有效，无需重新输入序列号

#### Scenario: 跨主版本升级需换号
- **WHEN** 用户已在 v1.x 激活，随后升级到 v2.0.0（主版本变为 2）
- **THEN** 启动时校验序列号主版本号 1 与 App 主版本号 2 不一致
- **AND** 激活记录失效，提示需要新版本对应的序列号，回到激活页

#### Scenario: 旧主版本序列号在新版上激活失败
- **WHEN** 用户在 v2.x 的 App 中输入主版本号为 1 的序列号
- **THEN** 主版本号校验不通过
- **AND** 激活被拒绝，提示序列号版本不匹配

### Requirement: 机器指纹绑定
系统 SHALL 基于本机硬件信息生成稳定的机器指纹，激活时将序列号绑定到该指纹，防止同一序列号在多台机器上使用。

#### Scenario: 首次激活绑定机器
- **WHEN** 用户在机器 A 上首次激活成功
- **THEN** 激活记录绑定机器 A 的指纹并安全存储
- **AND** 后续启动校验本机指纹与记录一致，直接放行

#### Scenario: 为新机器签发新序列号
- **WHEN** 开发者为机器 B 签发绑定了机器 B 指纹的新序列号
- **THEN** 机器 B 可用该序列号激活
- **AND** 旧序列号（绑定机器 A）在机器 B 上验签时机器指纹不匹配，激活失败

#### Scenario: 拷贝激活记录到其他机器
- **WHEN** 用户将机器 A 的激活记录文件拷贝到机器 B
- **THEN** 机器 B 启动时校验本机指纹与记录不符
- **AND** 清除失效记录并要求重新激活

### Requirement: 激活门禁
系统 SHALL 在应用启动时检查激活状态，未激活时仅显示激活页面，激活后才加载主应用。

#### Scenario: 未激活首次启动
- **WHEN** 应用首次启动且本地无激活记录
- **THEN** 显示激活页，展示本机机器码与序列号输入框
- **AND** 不加载主应用

#### Scenario: 已激活启动
- **WHEN** 应用启动且本地存在有效激活记录
- **THEN** 校验记录签名、主版本号与 App 当前主版本一致、未过期、机器指纹
- **AND** 校验通过则直接加载主应用

#### Scenario: 激活记录失效
- **WHEN** 启动时校验激活记录发现过期、机器指纹不符或主版本号不匹配
- **THEN** 清除失效记录，回到激活页

### Requirement: 激活信息安全存储
系统 SHALL 使用 Electron safeStorage（macOS Keychain / Windows DPAPI / Linux libsecret）加密存储激活记录，防止明文泄露或跨机器拷贝。

#### Scenario: 存储激活记录
- **WHEN** 激活成功
- **THEN** 激活记录（含序列号 payload、机器指纹、过期时间、签名）经 safeStorage 加密后写入用户数据目录
- **AND** 文件内容为密文，无法直接读取明文

### Requirement: 序列号生成工具
系统 SHALL 提供开发者侧命令行工具，使用私钥为指定机器指纹签发序列号，序列号中编码产品 ID、机器指纹、适用主版本号、签发时间、过期时间（0 表示永久）。

#### Scenario: 开发者签发限时序列号
- **WHEN** 开发者执行生成命令并传入私钥路径、机器指纹（或通配符）、主版本号、有效期（如 365 天）
- **THEN** 工具输出格式化的序列号字符串（可读分组格式）
- **AND** 该序列号在有效期内可在目标机器与对应主版本的 App 上验证通过

#### Scenario: 开发者签发永久序列号
- **WHEN** 开发者执行生成命令并指定永久有效（过期时间为 0）
- **THEN** 工具输出永久序列号
- **AND** 该序列号不进行过期校验，只要签名、主版本、机器指纹有效即长期可用

## MODIFIED Requirements

### Requirement: Next.js 构建配置
Next.js 构建配置 SHALL 启用 standalone 输出模式，以便 Electron 主进程以独立 Node 服务方式内嵌启动现有应用。

## REMOVED Requirements
（无）
