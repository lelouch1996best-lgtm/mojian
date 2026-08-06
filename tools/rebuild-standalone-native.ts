/**
 * 在 Next.js standalone 生成后，把 better-sqlite3 的原生模块替换为 Electron ABI 版本。
 *
 * 问题：Next.js standalone 从 node_modules 复制 better-sqlite3（含 Node ABI 的 .node），
 * 但 Electron 运行时需要 Electron ABI 的 .node。electron-builder 不会修复 standalone
 * 里的原生模块 ABI，导致打包后 API 加载数据库时报 NODE_MODULE_VERSION 不匹配（500）。
 *
 * 解决：用 prebuild-install 下载 Electron ABI 的预编译二进制，覆盖 standalone 里的 .node。
 * 无需 Python / C++ 工具链。
 */
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const projectRoot = process.cwd();
const standaloneDir = path.join(projectRoot, ".next", "standalone");
const sqliteDir = path.join(standaloneDir, "node_modules", "better-sqlite3");

// 从 node_modules/electron/package.json 读取 Electron 版本
const electronPkg = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "node_modules", "electron", "package.json"), "utf8")
);
const electronVersion = electronPkg.version;

console.log(`[rebuild-standalone] Electron 版本: ${electronVersion}`);
console.log(`[rebuild-standalone] standalone better-sqlite3: ${sqliteDir}`);

if (!fs.existsSync(sqliteDir)) {
  console.error(`[rebuild-standalone] 错误: ${sqliteDir} 不存在`);
  console.error(`[rebuild-standalone] 请确保已先运行 next build (standalone 模式)`);
  process.exit(1);
}

// 用 prebuild-install 下载 Electron ABI 的预编译二进制
// 直接用 node 执行 bin.js，跨平台兼容（不依赖 .bin/cmd 文件）
const prebuildBin = path.join(projectRoot, "node_modules", "prebuild-install", "bin.js");

console.log(`[rebuild-standalone] 下载 Electron ABI 预编译二进制...`);

execSync(
  `node "${prebuildBin}" --runtime electron --target ${electronVersion} --directory "${sqliteDir}"`,
  { stdio: "inherit", cwd: sqliteDir }
);

// 验证 .node 文件存在
const nodeFile = path.join(sqliteDir, "build", "Release", "better_sqlite3.node");
if (fs.existsSync(nodeFile)) {
  const size = fs.statSync(nodeFile).size;
  console.log(`[rebuild-standalone] 完成: ${nodeFile} (${(size / 1024).toFixed(0)} KB)`);
} else {
  console.error(`[rebuild-standalone] 错误: .node 文件未找到，prebuild-install 可能失败`);
  process.exit(1);
}
