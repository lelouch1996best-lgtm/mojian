import { app, safeStorage } from "electron";
import fs from "fs";
import path from "path";
import { verifyLicense } from "./license";
import { getMachineId } from "./machine-id";

/** 持久化的激活记录（密文存储） */
interface ActivationRecord {
  /** 完整序列号字符串，启动时用它重新验签以判定是否仍有效 */
  serial: string;
  /** 激活时间，Unix 秒 */
  activatedAt: number;
}

function recordPath(): string {
  return path.join(app.getPath("userData"), "activation.dat");
}

/**
 * 保存激活记录。使用 Electron safeStorage（macOS Keychain / Windows DPAPI /
 * Linux libsecret）加密；若系统不可用加密则回退为明文（仅本地文件）。
 */
export function saveActivation(serial: string): void {
  const record: ActivationRecord = {
    serial,
    activatedAt: Math.floor(Date.now() / 1000),
  };
  const json = JSON.stringify(record);
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, "utf8");
  fs.writeFileSync(recordPath(), data);
}

/** 读取激活记录；无记录或解密失败返回 null */
export function loadActivation(): ActivationRecord | null {
  const p = recordPath();
  if (!fs.existsSync(p)) return null;
  try {
    const buf = fs.readFileSync(p);
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString("utf8");
    return JSON.parse(json) as ActivationRecord;
  } catch {
    return null;
  }
}

/** 清除激活记录 */
export function clearActivation(): void {
  try {
    fs.unlinkSync(recordPath());
  } catch {
    /* 忽略：文件可能已不存在 */
  }
}

/**
 * 判定当前是否已激活：读取记录并用本机指纹与当前主版本号重新验签。
 * 任一校验失败（过期 / 换机 / 跨主版本 / 签名无效）则清除失效记录并返回 false。
 */
export function isActivated(): boolean {
  const rec = loadActivation();
  if (!rec) return false;
  const result = verifyLicense(rec.serial, getMachineId());
  if (!result.valid) {
    clearActivation();
    return false;
  }
  return true;
}
