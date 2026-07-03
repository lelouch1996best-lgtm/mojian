/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
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
