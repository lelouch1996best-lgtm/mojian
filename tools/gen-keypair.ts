/**
 * 生成 Ed25519 密钥对，写入：
 * - electron/keys/public.pem  （公钥，随应用打包分发；需 `git add -f` 提交）
 * - electron/keys/private.pem （私钥，严禁入库；.gitignore 已含 *.pem）
 *
 * 用法：npm run gen:keypair
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const KEYS_DIR = path.resolve(__dirname, "..", "electron", "keys");

function main() {
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

  fs.writeFileSync(path.join(KEYS_DIR, "public.pem"), publicPem, "utf8");
  fs.writeFileSync(path.join(KEYS_DIR, "private.pem"), privatePem, "utf8");

  console.log("已生成 Ed25519 密钥对：");
  console.log(`  公钥：${path.join(KEYS_DIR, "public.pem")}`);
  console.log(`  私钥：${path.join(KEYS_DIR, "private.pem")}`);
  console.log("\n注意：");
  console.log("  - private.pem 严禁入库（.gitignore 已排除 *.pem）。");
  console.log("  - public.pem 需随应用分发，提交时请用 git add -f。");
}

main();
