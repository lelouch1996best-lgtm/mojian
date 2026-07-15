/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
    }
    return config;
  },
};

export default nextConfig;
