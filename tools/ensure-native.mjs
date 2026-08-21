/**
 * 确保 node_modules/better-sqlite3 与当前 Node 运行时的 ABI 匹配。
 *
 * 背景：better-sqlite3 是 C++ 原生模块，Node 大版本升级（ABI 变化）或被
 * electron-builder / electron-rebuild 重编译成 Electron ABI 后，`next dev` /
 * `next start` 的所有数据库接口会因 NODE_MODULE_VERSION 不匹配而报 500。
 *
 * 本脚本在 dev / build / start 前自检：尝试用当前 Node 实例化 better-sqlite3，
 * 失败则通过 `npm rebuild`（内部走 prebuild-install 下载预编译二进制）自动重建，
 * 无需本地 Python / C++ 工具链；重建后再次校验，仍失败则报错退出。
 */
import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "node_modules", "better-sqlite3");

if (!fs.existsSync(pkgDir)) {
  process.exit(0);
}

function checkNative() {
  return spawnSync(
    process.execPath,
    ["-e", "new (require('better-sqlite3'))(':memory:')"],
    { cwd: root, encoding: "utf8" }
  );
}

let result = checkNative();
if (result.status === 0) {
  process.exit(0);
}

console.log("[ensure-native] better-sqlite3 与当前 Node 不兼容，开始自动重建...");
const abiInfo = result.stderr && result.stderr.match(/NODE_MODULE_VERSION \d+/g);
if (abiInfo) console.log(`[ensure-native] ${abiInfo.join(" / ")}`);

const env = { ...process.env };
[
  "runtime",
  "target",
  "disturl",
  "node_gyp",
  "arch",
  "target_arch",
  "platform",
  "target_platform",
  "devdir",
  "build_from_source",
  "fallback_to_build",
  "update_binary",
  "libc",
  "target_libc",
].forEach((k) => delete env[`npm_config_${k}`]);

execSync("npm rebuild better-sqlite3", { stdio: "inherit", cwd: root, env });

result = checkNative();
if (result.status !== 0) {
  console.error("[ensure-native] 重建后仍无法加载 better-sqlite3：");
  console.error(result.stderr || String(result.error));
  console.error(
    `[ensure-native] 当前 Node ${process.version}（ABI ${process.versions.modules}），请检查网络（prebuild 下载）或本地编译工具链`
  );
  process.exit(1);
}

console.log("[ensure-native] better-sqlite3 已就绪（当前 Node 可用）");
