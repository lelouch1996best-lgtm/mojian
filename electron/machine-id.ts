import crypto from "crypto";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";

let cached: string | null = null;

/**
 * 获取本机稳定机器指纹（SHA256 hex）。
 * 跨平台采集硬件级唯一标识后做哈希，保证：
 * - 同机多次取值一致（稳定）
 * - 不直接暴露原始硬件序列（哈希化）
 * 不同机器的指纹不同，用于序列号绑定，防止一码多用。
 */
export function getMachineId(): string {
  if (cached) return cached;
  const raw = readRawMachineId();
  cached = crypto.createHash("sha256").update(raw).digest("hex");
  return cached;
}

/** 采集原始硬件标识：macOS 用 IOPlatformUUID、Windows 用 MachineGuid、Linux 用 machine-id */
function readRawMachineId(): string {
  try {
    if (process.platform === "darwin") {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice", {
        encoding: "utf8",
      });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else if (process.platform === "win32") {
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: "utf8" }
      );
      const m = out.match(/MachineGuid\s+REG_SZ\s+([^\s\r\n]+)/);
      if (m) return m[1];
    } else if (process.platform === "linux") {
      for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
      }
    }
  } catch {
    /* 采集失败则走 fallback */
  }
  // fallback：主机名（稳定性弱于硬件 ID，但保证有值可用）
  return os.hostname();
}

/**
 * 供激活页展示的机器码（每 4 位一组，便于阅读与抄录给开发者签发）。
 * 注意：开发者签发时须使用 getMachineId() 的完整 hex，而非此展示形式。
 */
export function getDisplayMachineId(): string {
  return getMachineId().match(/.{1,4}/g)!.join("-");
}
