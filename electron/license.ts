import crypto from "crypto";
import fs from "fs";
import path from "path";

/** 产品标识，序列号 payload 中必须与此一致 */
export const PRODUCT_ID = "mojian";

/**
 * 归一化机器码：去除分组分隔符（- / 空格 / 换行）并转小写。
 * 激活页展示并复制的是分组形式（如 953c-2df2-...），而 getMachineId() 返回原始 hex。
 * 签发与验签两侧统一归一化，保证用户复制分组码发给开发者、开发者原样用作 --machine 时仍能匹配。
 */
export function normalizeMachineId(input: string): string {
  return input.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

/** 序列号 payload 结构。生成端（tools/gen-license.ts）与验证端共用此结构约定。 */
export interface LicensePayload {
  /** 产品 ID，固定为 PRODUCT_ID */
  productId: string;
  /** 机器指纹；"*" 表示通配（一码通用），否则为具体机器码 */
  machineId: string;
  /** 适用主版本号；App 读取自身主版本号与之比对，跨主版本需换号 */
  majorVersion: number;
  /** 签发时间，Unix 秒 */
  issuedAt: number;
  /** 过期时间，Unix 秒；0 表示永久有效 */
  expiresAt: number;
  /** 授权等级，预留 */
  tier: string;
}

/** 验证结果：成功时返回 payload，失败时返回中文错误原因 */
export type VerifyResult =
  | { valid: true; payload: LicensePayload }
  | { valid: false; error: string };

/**
 * 将 payload 规范编码为 base64 字符串（去除 = 填充）。
 * 注意：刻意使用标准 base64（字母表 A-Za-z0-9+/，不含 '-'）而非 base64url，
 * 这样 '-' 可安全用作可读分组分隔符、'.' 可安全用作 payload/signature 段分隔符，
 * 解码时去掉 '-' 不会破坏数据。此函数为签名与编码的单一事实来源。
 */
export function encodePayload(payload: LicensePayload): string {
  return Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/=+$/, "");
}

/** 读取 Electron 的 resourcesPath（生产期存在；@types/node 不含此字段，需安全转换） */
function electronResourcesPath(): string {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? "";
}

/**
 * 加载内嵌公钥。公钥以 PEM 文件随应用分发：
 * - 开发期：electron/keys/public.pem（相对 dist-electron 上级）
 * - 生产期：process.resourcesPath/keys/public.pem（由 electron-builder 打入）
 * 找不到时抛出清晰错误，提示开发者运行 `npm run gen:keypair`。
 */
export function loadPublicKey(): crypto.KeyObject {
  const candidates = [
    path.join(electronResourcesPath(), "keys", "public.pem"),
    path.join(__dirname, "..", "electron", "keys", "public.pem"),
    path.join(process.cwd(), "electron", "keys", "public.pem"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return crypto.createPublicKey(fs.readFileSync(p, "utf8"));
      }
    } catch {
      /* 尝试下一个候选路径 */
    }
  }
  throw new Error(
    "未找到公钥文件 public.pem，请先运行 `npm run gen:keypair` 生成 Ed25519 密钥对。"
  );
}

/** 读取应用自身主版本号（package.json version 的主版本段） */
export function getAppMajorVersion(): number {
  const candidates = [
    process.env.APP_VERSION,
    safeReadPackageVersion(path.join(__dirname, "..", "package.json")),
    safeReadPackageVersion(path.join(electronResourcesPath(), "app", "package.json")),
    safeReadPackageVersion(path.join(process.cwd(), "package.json")),
  ];
  for (const v of candidates) {
    if (v) {
      const major = parseInt(v.split(".")[0], 10);
      if (!Number.isNaN(major)) return major;
    }
  }
  return 1;
}

function safeReadPackageVersion(pkgPath: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(pkgPath)?.version;
  } catch {
    return undefined;
  }
}

/**
 * 将 payload 与签名编码为可读序列号：
 * combined = encodePayload(payload) + "." + base64(signature)
 * 再按每 5 字符一组用 "-" 分段，便于用户阅读与输入。
 * 签名须对 encodePayload(payload) 的字节做（见 verifyLicense）。
 */
export function formatSerial(
  payload: LicensePayload,
  signature: Buffer
): string {
  const payloadB64 = encodePayload(payload);
  const sigB64 = signature.toString("base64").replace(/=+$/, "");
  return `${payloadB64}.${sigB64}`.match(/.{1,5}/g)!.join("-");
}

/** 解析序列号字符串，返回 payloadB64 与签名 Buffer；格式非法返回 null */
export function decodeSerial(
  serial: string
): { payloadB64: string; signature: Buffer; payload: LicensePayload } | null {
  try {
    // 去掉可读分组分隔符 '-'（标准 base64 不含 '-'，故安全）与空白
    const cleaned = serial.replace(/[-\s]/g, "");
    if (!/^[A-Za-z0-9+/]+\.[A-Za-z0-9+/]+$/.test(cleaned)) return null;
    const [payloadB64, sigB64] = cleaned.split(".");
    const payloadJson = Buffer.from(payloadB64, "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as LicensePayload;
    const signature = Buffer.from(sigB64, "base64");
    return { payloadB64, signature, payload };
  } catch {
    return null;
  }
}

/**
 * 验证序列号：
 * 1. 解析格式
 * 2. 用内嵌公钥验签（签名对象为 encodePayload(payload) 的字节，即序列号中实际承载的规范字符串）
 * 3. 校验产品 ID、主版本号、机器指纹、过期时间
 */
export function verifyLicense(
  serial: string,
  currentMachineId: string,
  currentMajorVersion = getAppMajorVersion()
): VerifyResult {
  const decoded = decodeSerial(serial);
  if (!decoded) return { valid: false, error: "序列号格式无效" };

  const { payloadB64, signature, payload } = decoded;
  const sigOk = crypto.verify(
    null,
    Buffer.from(payloadB64),
    loadPublicKey(),
    signature
  );
  if (!sigOk) return { valid: false, error: "序列号签名验证失败" };

  if (payload.productId !== PRODUCT_ID) {
    return { valid: false, error: "序列号产品不匹配" };
  }
  if (payload.majorVersion !== currentMajorVersion) {
    return {
      valid: false,
      error: `序列号版本不匹配，请使用 v${currentMajorVersion} 对应的序列号`,
    };
  }
  if (payload.machineId !== "*") {
    // 归一化后比对，兼容分组形式与原始 hex（见 normalizeMachineId 说明）
    if (normalizeMachineId(payload.machineId) !== normalizeMachineId(currentMachineId)) {
      return { valid: false, error: "序列号与当前机器不匹配" };
    }
  }
  if (payload.expiresAt !== 0 && Date.now() / 1000 > payload.expiresAt) {
    return { valid: false, error: "序列号已过期" };
  }

  return { valid: true, payload };
}
