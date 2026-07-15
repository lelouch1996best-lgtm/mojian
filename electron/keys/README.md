# electron/keys

本目录存放序列号激活所需的 **Ed25519** 密钥对。

## 文件说明

- `public.pem`：公钥，随应用打包分发，App 启动时由 `electron/license.ts` 读取用于验签。
- `private.pem`：私钥，**严禁入库**，仅在开发者离线签发序列号时使用。

> `.gitignore` 已包含 `*.pem`，默认两个 pem 文件都不会被提交。
> 公钥需随应用分发，提交时请显式 `git add -f electron/keys/public.pem`。

## 首次使用流程

```bash
# 1. 生成 Ed25519 密钥对（写入 public.pem 与 private.pem）
npm run gen:keypair

# 2. 签发序列号
#    永久 + 一码通用：
npm run gen:license -- --machine "*" --vmaj 1
#    限时 365 天 + 绑定具体机器码：
npm run gen:license -- --machine <机器码> --vmaj 1 --days 365
```

> 私钥务必妥善保管，丢失后已签发的序列号仍可验签，但无法再签发同密钥的新序列号；
> 若私钥泄露，需重新 `gen:keypair` 并用新公钥重新打包发布，旧序列号将全部失效。
