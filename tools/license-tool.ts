/**
 * 墨间 · 序列号签发工具（本地 Web 界面）
 *
 * 仅在本机 127.0.0.1 运行，读取 electron/keys/private.pem 进行 Ed25519 签名。
 * 这是开发者专用工具，绝不可打包进客户端分发给用户（涉及私钥安全）。
 *
 * 用法：npm run license:tool
 * 打开：http://127.0.0.1:7788
 */

import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import {
  PRODUCT_ID,
  encodePayload,
  formatSerial,
  normalizeMachineId,
  type LicensePayload,
} from "../electron/license";

const PORT = 7788;
const HOST = "127.0.0.1";
const PRIVATE_KEY_PATH = path.resolve(__dirname, "..", "electron", "keys", "private.pem");

/** 读取 package.json 主版本号作为表单默认值 */
function readDefaultMajorVersion(): number {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")
    );
    return parseInt(String(pkg.version).split(".")[0], 10) || 1;
  } catch {
    return 1;
  }
}

/** 检查私钥是否存在 */
function privateKeyExists(): boolean {
  return fs.existsSync(PRIVATE_KEY_PATH);
}

interface GenerateBody {
  machine: string;
  vmaj: number;
  days: number;
  tier: string;
}

/** 签发序列号：复用 license.ts 的编码与签名规范 */
function generateSerial(body: GenerateBody): {
  ok: boolean;
  serial?: string;
  payload?: LicensePayload;
  error?: string;
} {
  if (!privateKeyExists()) {
    return {
      ok: false,
      error: "未找到私钥文件，请先运行 `npm run gen:keypair` 生成密钥对。",
    };
  }
  const vmaj = Number(body.vmaj);
  if (!Number.isFinite(vmaj) || vmaj < 1) {
    return { ok: false, error: "主版本号必须为正整数" };
  }
  const machine = (body.machine || "").trim();
  if (!machine) {
    return { ok: false, error: "机器码不能为空（通配请填 *）" };
  }
  const machineId = machine === "*" ? "*" : normalizeMachineId(machine);
  if (machineId !== "*" && machineId.length === 0) {
    return { ok: false, error: "机器码格式无效" };
  }
  const days = Math.max(0, Number(body.days) || 0);
  const tier = (body.tier || "pro").trim() || "pro";

  let privateKey: crypto.KeyObject;
  try {
    privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE_KEY_PATH, "utf8"));
  } catch {
    return { ok: false, error: "私钥文件读取失败，可能已损坏" };
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    return { ok: false, error: "私钥不是 Ed25519 类型，请用 gen:keypair 重新生成" };
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: LicensePayload = {
    productId: PRODUCT_ID,
    machineId,
    majorVersion: vmaj,
    issuedAt: now,
    expiresAt: days > 0 ? now + days * 86400 : 0,
    tier,
  };

  const payloadB64 = encodePayload(payload);
  const signature = crypto.sign(null, Buffer.from(payloadB64), privateKey);
  const serial = formatSerial(payload, signature);

  return { ok: true, serial, payload };
}

/** 读取请求 JSON body */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e5) reject(new Error("请求体过大"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** 简易 JSON 响应 */
function sendJson(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveHtml(res: http.ServerResponse) {
  const defaultVmaj = readDefaultMajorVersion();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderHtml(defaultVmaj));
}

function renderHtml(defaultVmaj: number): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>墨间 · 序列号签发工具</title>
<style>
  :root {
    --bg: #FFFBEB; --card: #fff; --ink: #44403C; --body: #78716C;
    --border: #EDE7D6; --border-strong: #D9D3C8; --accent: #D97706;
    --accent-dark: #B45309; --danger-bg: #FEF2F2; --danger-border: #FECACA; --danger: #B91C1C;
    --success-bg: #FDF6E3; --success-border: #EDE7D6; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg); color: var(--body); min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 32px 16px;
  }
  .wrap { width: 100%; max-width: 560px; }
  .brand { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 28px; }
  .logo {
    width: 44px; height: 44px; border-radius: 12px; background: var(--ink);
    color: var(--bg); display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 24px -4px rgba(68,64,60,0.18);
  }
  .brand-name { font-family: "Noto Serif SC", Georgia, serif; font-size: 20px; font-weight: 700; color: var(--ink); letter-spacing: 2px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px -6px rgba(120,113,108,0.06), 0 12px 32px -10px rgba(120,113,108,0.04); }
  h1 { font-family: "Noto Serif SC", Georgia, serif; font-size: 24px; font-weight: 700; color: var(--ink); text-align: center; margin-bottom: 6px; }
  .subtitle { text-align: center; font-size: 13px; color: var(--body); margin-bottom: 24px; line-height: 1.6; }
  .field { margin-bottom: 18px; }
  label { display: block; font-size: 13px; font-weight: 500; color: var(--ink); margin-bottom: 6px; }
  input { width: 100%; padding: 10px 14px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--bg); font-size: 14px; color: var(--ink); outline: none; transition: border-color .15s, box-shadow .15s; }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(217,119,6,0.15); }
  input.mono { font-family: var(--mono); font-size: 13px; }
  .hint { font-size: 12px; color: #928A80; margin-top: 5px; line-height: 1.5; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .btn {
    width: 100%; padding: 13px; border: none; border-radius: 10px; background: var(--ink);
    color: var(--bg); font-size: 15px; font-weight: 500; cursor: pointer; transition: background .15s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .btn:hover { background: #3D3935; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .spinner { width: 16px; height: 16px; border: 2px solid rgba(255,251,235,0.3); border-top-color: var(--bg); border-radius: 50%; animation: spin .7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .alert { padding: 11px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; line-height: 1.5; }
  .alert-error { background: var(--danger-bg); border: 1px solid var(--danger-border); color: var(--danger); }
  .result { margin-top: 22px; display: none; }
  .result.show { display: block; }
  .result-label { font-size: 13px; font-weight: 500; color: var(--ink); margin-bottom: 8px; }
  .serial-box {
    display: flex; gap: 8px; align-items: stretch; background: var(--success-bg);
    border: 1px solid var(--success-border); border-radius: 10px; padding: 4px;
  }
  .serial-text { flex: 1; padding: 10px 12px; font-family: var(--mono); font-size: 12.5px; color: var(--ink); word-break: break-all; line-height: 1.6; user-select: all; }
  .copy-btn { flex-shrink: 0; padding: 0 16px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--card); color: var(--ink); font-size: 13px; cursor: pointer; transition: background .15s; }
  .copy-btn:hover { background: var(--bg); }
  .copy-btn.copied { background: var(--accent); color: white; border-color: var(--accent); }
  .summary { margin-top: 16px; padding: 14px 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; }
  .summary-row { display: flex; justify-content: space-between; font-size: 13px; padding: 3px 0; }
  .summary-row span:first-child { color: #928A80; }
  .summary-row span:last-child { color: var(--ink); font-family: var(--mono); font-size: 12px; }
  .keywarn { background: var(--danger-bg); border: 1px solid var(--danger-border); color: var(--danger); }
  .footer { margin-top: 20px; text-align: center; font-size: 12px; color: #928A80; line-height: 1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="logo">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 21L7.5 16.5M7.5 16.5C6 15 6 13 7.5 11.5L14 5C15.5 3.5 17.5 3.5 19 5C20.5 6.5 20.5 8.5 19 10L12.5 16.5C11 18 9 18 7.5 16.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <span class="brand-name">墨间</span>
  </div>
  <div class="card">
    <h1>序列号签发工具</h1>
    <p class="subtitle">本地离线签发 · 私钥不会离开本机<br/>仅供开发者使用，请勿对外公开此页面</p>

    <div id="keyWarn" class="alert alert-error keywarn" style="display:none;">
      未检测到私钥，请先在项目根目录运行 <code>npm run gen:keypair</code>
    </div>

    <div id="errBox" class="alert alert-error" style="display:none;"></div>

    <form id="form">
      <div class="field">
        <label for="machine">机器码</label>
        <input id="machine" class="mono" type="text" placeholder="953c-2df2-5f3b-...（填 * 为通配，一码通用）" autocomplete="off" />
        <div class="hint">用户从激活页复制的机器码直接粘贴即可（带 - 分组或原始 hex 均可）；填 <b>*</b> 表示一码通用</div>
      </div>
      <div class="row">
        <div class="field">
          <label for="vmaj">主版本号</label>
          <input id="vmaj" type="number" min="1" step="1" value="${defaultVmaj}" />
          <div class="hint">须与 App 主版本一致</div>
        </div>
        <div class="field">
          <label for="days">有效期（天）</label>
          <input id="days" type="number" min="0" step="1" value="0" />
          <div class="hint">0 = 永久</div>
        </div>
      </div>
      <div class="field">
        <label for="tier">授权等级</label>
        <input id="tier" type="text" value="pro" autocomplete="off" />
      </div>
      <button type="submit" class="btn" id="genBtn">
        <span id="btnText">生成序列号</span>
      </button>
    </form>

    <div id="result" class="result">
      <div class="result-label">序列号</div>
      <div class="serial-box">
        <div id="serialText" class="serial-text"></div>
        <button type="button" class="copy-btn" id="copyBtn">复制</button>
      </div>
      <div id="summary" class="summary"></div>
    </div>
  </div>
  <p class="footer">本工具仅在 127.0.0.1 本地运行 · 私钥安全由你负责</p>
</div>
<script>
  const $ = (id) => document.getElementById(id);

  // 启动时检查私钥状态
  fetch("/api/status").then(r => r.json()).then(d => {
    if (!d.hasKey) $("keyWarn").style.display = "block";
  }).catch(() => {});

  function formatDate(ts) {
    if (ts === 0) return "永久";
    return new Date(ts * 1000).toLocaleString("zh-CN");
  }

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("errBox").style.display = "none";
    $("result").classList.remove("show");
    const btn = $("genBtn"); btn.disabled = true;
    $("btnText").innerHTML = '<span class="spinner"></span> 签发中…';
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machine: $("machine").value.trim(),
          vmaj: Number($("vmaj").value),
          days: Number($("days").value),
          tier: $("tier").value.trim(),
        }),
      });
      const d = await res.json();
      if (!d.ok) {
        $("errBox").textContent = d.error || "签发失败";
        $("errBox").style.display = "block";
        return;
      }
      $("serialText").textContent = d.serial;
      const p = d.payload;
      $("summary").innerHTML =
        '<div class="summary-row"><span>产品 ID</span><span>' + p.productId + '</span></div>' +
        '<div class="summary-row"><span>机器码</span><span>' + p.machineId + '</span></div>' +
        '<div class="summary-row"><span>主版本</span><span>v' + p.majorVersion + '</span></div>' +
        '<div class="summary-row"><span>签发时间</span><span>' + formatDate(p.issuedAt) + '</span></div>' +
        '<div class="summary-row"><span>有效期至</span><span>' + formatDate(p.expiresAt) + '</span></div>' +
        '<div class="summary-row"><span>等级</span><span>' + p.tier + '</span></div>';
      $("result").classList.add("show");
    } catch (err) {
      $("errBox").textContent = "请求失败：" + err.message;
      $("errBox").style.display = "block";
    } finally {
      btn.disabled = false;
      $("btnText").textContent = "生成序列号";
    }
  });

  $("copyBtn").addEventListener("click", async () => {
    const text = $("serialText").textContent;
    try {
      await navigator.clipboard.writeText(text);
      const b = $("copyBtn"); b.classList.add("copied"); b.textContent = "已复制";
      setTimeout(() => { b.classList.remove("copied"); b.textContent = "复制"; }, 2000);
    } catch {
      // 兜底：选中文本
      const range = document.createRange(); range.selectNode($("serialText"));
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    }
  });
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}`);
  try {
    if (req.method === "GET" && url.pathname === "/") {
      serveHtml(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, { hasKey: privateKeyExists() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as GenerateBody;
      const result = generateSerial(body);
      sendJson(res, 200, result);
      return;
    }
    sendJson(res, 404, { error: "Not Found" });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: (err as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  墨间序列号签发工具已启动`);
  console.log(`  ➜  打开浏览器访问：http://${HOST}:${PORT}\n`);
  if (!privateKeyExists()) {
    console.log(`  ⚠  未检测到私钥，请先运行：npm run gen:keypair\n`);
  }
});
