import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig} */
const nextConfig = (phase) => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    // standalone 输出仅在生产构建时启用，dev 模式下会导致 HMR 后 server chunk 引用失效
    output: isDev ? undefined : "standalone",
    reactStrictMode: false,
    // cos-nodejs-sdk-v5 含服务端依赖，标记为外部包避免被打包进客户端 bundle
    experimental: {
      serverComponentsExternalPackages: ["cos-nodejs-sdk-v5"],
    },
    // macOS 热更新优化
    webpack: (config, { dev }) => {
      if (dev) {
        config.watchOptions = {
          poll: 500,              // 500ms 轮询一次，兼顾响应速度与 CPU
          aggregateTimeout: 200,  // 200ms 合并连续变更，减少重复编译
          ignored: /node_modules/,
        };
        // 修复 HMR 时代码分割 chunk 缓存失效导致的 Cannot find module './xxx.js'
        config.cache = false;
      }
      return config;
    },
  };
};

export default nextConfig;
