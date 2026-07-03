import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ---- 应用主色：映射为墨间暖色系 ----
        // brand-* 用于主按钮 / 选中态 / 焦点环 / 强调
        // 400-500 为琥珀强调色，600-700 为深墨色（主 CTA）
        brand: {
          50: "#FDF6E3",
          100: "#F5F0E0",
          200: "#EDE7D6",
          300: "#D9D3C8",
          400: "#B45309",
          500: "#D97706",
          600: "#44403C",
          700: "#3D3935",
        },
        // ---- 中性色：覆盖默认 slate 为暖灰 ----
        // slate-* 用于文字层级 / 边框 / 浅底
        slate: {
          50: "#FDF6E3",
          100: "#F5F0E0",
          200: "#EDE7D6",
          300: "#D9D3C8",
          400: "#A8A29E",
          500: "#928A80",
          600: "#78716C",
          700: "#57534E",
          800: "#44403C",
          900: "#44403C",
        },
        // ---- 落地页设计令牌（严格还原画布稿） ----
        warm: {
          50: "#FFFBEB",   // 主背景 / Hero 渐变起点
          100: "#FDF6E3",  // Step number badge bg
          200: "#F5F0E0",  // 边框色
          300: "#EDE7D6",  // 分隔线
          400: "#D9D3C8",  // 边框强调
          500: "#B8AEA2",  // placeholder text
          600: "#A8A29E",  // 浅色文字 / Footer logo
          700: "#928A80",  // 次级文字
          800: "#78716C",  // 正文文字 / CTA 按钮 / nav
          900: "#57534E",  // 导航文字
          950: "#44403C",  // 标题文字 / 主 CTA / Footer bg
        },
        amber: {
          accent: "#D97706",  // 强调色 - section label / eyebrow dot
          light: "#FEF3C7",   // amber badge bg
          medium: "#FDE68A",
          dark: "#92400E",    // tag text
          darker: "#854D0E",  // greenish tag
          deepest: "#4D7C0F", // green tag
        },
      },
      fontFamily: {
        serif: ["Noto Serif SC", "Georgia", "serif"],
        sans: ["Noto Sans SC", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      fontSize: {
        "hero": ["72px", { lineHeight: "115%", letterSpacing: "-1px" }],
        "section": ["42px", { lineHeight: "120%" }],
        "feature-head": ["32px", { lineHeight: "125%" }],
        "step-head": ["20px", { lineHeight: "130%" }],
        "body-lg": ["18px", { lineHeight: "170%" }],
        "body-base": ["16px", { lineHeight: "180%" }],
        "body-sm": ["14px", { lineHeight: "170%" }],
        "caption": ["13px", { letterSpacing: "1px" }],
        "nav": ["15px", {}],
      },
      borderRadius: {
        "card": "16px",
        "pill": "9999px",
        "soft": "12px",
      },
      boxShadow: {
        "card":
          "0 4px 20px -6px rgba(120, 113, 108, 0.06), 0 12px 32px -10px rgba(120, 113, 108, 0.04)",
        "card-hover":
          "0 8px 28px -6px rgba(120, 113, 108, 0.10), 0 16px 40px -10px rgba(120, 113, 108, 0.06)",
        "screenshot": "0 8px 28px -8px rgba(120, 113, 108, 0.08)",
        "cta": "0 8px 24px -4px rgba(68, 64, 60, 0.18)",
        "glow": "0 0 120px 60px",
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(180deg, #FFFBEB 0%, #F3F3E0 50%, #F7EBD5 100%)",
        "screenshot-warm":
          "linear-gradient(135deg, #F3E8D9 0%, #E7DCCA 100%)",
        "screenshot-sage":
          "linear-gradient(135deg, #ECCEE0 0%, #E1E4D5 100%)",
        "screenshot-gold":
          "linear-gradient(135deg, #F0E7DB 0%, #E3DBCd 100%)",
      },
      maxWidth: {
        "content": "1280px",
        "hero-text": "900px",
      },
    },
  },
  plugins: [],
};

export default config;
