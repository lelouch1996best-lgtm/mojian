/**
 * 开发者侧序列号签发工具（离线）。
 * 使用 electron/keys/private.pem 对 payload 做 Ed25519 签名，输出可读分组序列号。
 *
 * 用法示例：
 *   永久 + 通配（一码通用）：
 *     npm run gen:license -- --machine "*" --vmaj 1
 *   限时 365 天 + 绑定具体机器：
 *     npm run gen:license -- --machine <机器码> --vmaj 1 --days 365
 *
 * 签名规范（须与 electron/license.ts 的 verifyLicense 一致）：
 *   payloadB64 = base64url(JSON.stringify(payload))
 *   signature  = ed25519_sign(payloadB64 的 UTF8 字节, privateKey)
 *   serial     = 每 5 字符一组用 "-" 分段的 payloadB64.signature
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  PRODUCT_ID,
  encodePayload,
  formatSerial,
  normalizeMachineId,
  type LicensePayload,
} from "../electron/license";

interface Args {
  privatePath: string;
  machine: string;
  vmaj: number;
  days: number;
  tier: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pkgVersion = readPkgMajor();
  const days = get("days") ? parseInt(get("days")!, 10) : 0;
  return {
    privatePath: get("private") ?? path.resolve(__dirname, "..", "electron", "keys", "private.pem"),
    machine: get("machine") ?? "*",
    vmaj: get("vmaj") ? parseInt(get("vmaj")!, 10) : pkgVersion,
    days: Number.isNaN(days) ? 0 : days,
    tier: get("tier") ?? "pro",
  };
}

function readPkgMajor(): number {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")
    );
    return parseInt(String(pkg.version).split(".")[0], 10) || 1;
  } catch {
    return 1;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.privatePath)) {
    console.error(`未找到私钥文件：${args.privatePath}`);
    console.error("请先运行 `npm run gen:keypair` 生成密钥对。");
    process.exit(1);
  }

  const privateKey = crypto.createPrivateKey(
    fs.readFileSync(args.privatePath, "utf8")
  );
  if (privateKey.asymmetricKeyType !== "ed25519") {
    console.error("私钥不是 Ed25519 类型，请用 gen:keypair 重新生成。");
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  // 通配符 "*" 保留原样；否则归一化为原始 hex，确保与 App 内 getMachineId() 比对一致
  const machineId = args.machine === "*" ? "*" : normalizeMachineId(args.machine);
  const payload: LicensePayload = {
    productId: PRODUCT_ID,
    machineId,
    majorVersion: args.vmaj,
    issuedAt: now,
    expiresAt: args.days > 0 ? now + args.days * 86400 : 0,
    tier: args.tier,
  };

  // 对 encodePayload(payload) 签名（与 verifyLicense 的验签对象完全一致）
  const payloadB64 = encodePayload(payload);
  const signature = crypto.sign(null, Buffer.from(payloadB64), privateKey);
  const serial = formatSerial(payload, signature);

  console.log("序列号已签发：\n");
  console.log(serial);
  console.log("\nPayload 摘要：");
  console.log(`  产品ID    : ${payload.productId}`);
  console.log(`  机器指纹   : ${payload.machineId}`);
  console.log(`  主版本号   : ${payload.majorVersion}`);
  console.log(
    `  有效期    : ${payload.expiresAt === 0 ? "永久" : new Date(payload.expiresAt * 1000).toISOString()}`
  );
  console.log(`  等级      : ${payload.tier}`);
}

main();
