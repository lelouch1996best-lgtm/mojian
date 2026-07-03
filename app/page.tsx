"use client";

import React from "react";
import { useRouter } from "next/navigation";

/* ============================================
   墨间 AI 剧本工具 - Landing Page
   严格还原画布设计稿
   ============================================ */

// ---- SVG Icons (inline for zero dependency) ----

const BrushIcon = ({ className, size = 18 }: { className?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M3 21L7.5 16.5M7.5 16.5C6 15 6 13 7.5 11.5L14 5C15.5 3.5 17.5 3.5 19 5C20.5 6.5 20.5 8.5 19 10L12.5 16.5C11 18 9 18 7.5 16.5Z"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArrowRightIcon = ({ className, size = 18 }: { className?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon = ({ className, size = 16 }: { className?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M5 13L9 17L19 7" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);


// ---- Header Component ----

function Header({ onStart }: { onStart: () => void }) {
  const navItems = [
    { label: "产品", href: "#features" },
    { label: "创作流程", href: "#flow" },
    { label: "核心功能", href: "#features" },
    { label: "关于", href: "#footer" },
  ];

  return (
    <header className="header-container">
      {/* Logo */}
      <a href="/" className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-warm-800 flex items-center justify-center">
          <BrushIcon size={18} className="text-warm-50" />
        </div>
        <span
          className="font-serif font-bold text-[22px] text-warm-950"
          style={{ letterSpacing: "2px" }}
        >
          墨间
        </span>
      </a>

      {/* Navigation */}
      <nav className="hidden md:flex items-center gap-9">
        {navItems.map((item) => (
          <a
            key={item.label}
            href={item.href}
            className="font-sans text-nav font-medium text-warm-900 hover:text-warm-950 transition-colors"
          >
            {item.label}
          </a>
        ))}
      </nav>

      {/* CTA Area */}
      <div className="flex items-center gap-5">
        <a
          href="#"
          className="font-sans text-nav font-medium text-warm-900 hover:text-warm-950 transition-colors"
        >
          登录
        </a>
        <button
          onClick={onStart}
          className="btn-primary py-2.5 px-5.5 text-nav !py-[10px] !px-[22px]"
        >
          开始创作
        </button>
      </div>
    </header>
  );
}


// ---- Hero Component ----

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="hero-section">
      {/* Glow effects */}
      <div className="hero-glow hero-glow--amber" aria-hidden="true" />
      <div className="hero-glow hero-glow--sage" aria-hidden="true" />
      <div className="hero-glow hero-glow--gold" aria-hidden="true" />

      <div className="hero-content">
        {/* Eyebrow */}
        <div className="eyebrow-badge">
          <span className="eyebrow-badge__dot" />
          <span className="eyebrow-badge__text">为创作者而生的剧本工具</span>
        </div>

        {/* Headline */}
        <h1 className="hero-headline">
          让故事安静地，<br />长成视频
        </h1>

        {/* Subheadline */}
        <p className="hero-subheadline">
          从一段文字到完整分镜，AI 在你身侧呼吸般陪伴。
          <br />
          扩写、分镜、资产、视频——四步，慢一点，但不慌。
        </p>

        {/* CTAs */}
        <div className="hero-ctas">
          <button className="btn-primary" onClick={onStart}>
            开始你的第一段故事
            <ArrowRightIcon size={18} className="text-warm-50" />
          </button>
          <a className="btn-secondary" href="#flow">看看怎么运作</a>
        </div>
      </div>
    </section>
  );
}


// ---- How It Works Section ----

const STEPS_DATA = [
  {
    num: 1,
    title: "内容扩写",
    desc: "把脑中的故事梗概写下来，AI 帮你把骨架填上血肉。边生成边阅读，停下、改写、继续，节奏由你。",
    tag: { text: "灵感 → 完整故事", variant: "amber" as const },
  },
  {
    num: 2,
    title: "分镜生成",
    desc: "自动拆解为镜头：时长、景别、光影、运镜、对白、音效，一气呵成。每个镜头都是你故事的切片。",
    tag: { text: "故事 → 镜头表", variant: "olive" as const },
  },
  {
    num: 3,
    title: "资产准备",
    desc: "画面描述中的人物、场景、物品，AI 自动识别并打上标签。一键生成参考图片，让每个角色都有脸有景。",
    tag: { text: "标注 → 参考图", variant: "sage" as const },
  },
  {
    num: 4,
    title: "视频生成",
    desc: "调用大模型为每个镜头生成视频提示词，关联资产参考图保证画面一致性，最终让每一镜真的动起来。",
    tag: { text: "提示词 → 视频", variant: "gold" as const },
  },
];

function StepCard({ step }: { step: typeof STEPS_DATA[0] }) {
  return (
    <article className="step-card group hover:shadow-card-hover transition-shadow duration-300">
      <span className="step-number">{step.num}</span>
      <h3 className="step-title">{step.title}</h3>
      <p className="step-desc">{step.desc}</p>
      <span className={`step-tag step-tag--${step.tag.variant}`}>{step.tag.text}</span>
    </article>
  );
}

function HowItWorks() {
  return (
    <section id="flow" className="section-block bg-warm-50">
      <div className="max-w-content mx-auto">
        <div className="section-header">
          <span className="section-label">创作流程</span>
          <h2 className="section-title">故事是这样生长的</h2>
        </div>

        <div className="steps-grid">
          {STEPS_DATA.map((step) => (
            <StepCard key={step.num} step={step} />
          ))}
        </div>
      </div>
    </section>
  );
}


// ---- Core Features Section ----

const FEATURES_DATA = [
  {
    badge: { text: "Step 1 · 内容扩写", variant: "amber" as const },
    headline: "流式扩写，灵感不被打断",
    desc: "AI 一字一句地生成扩写结果，你可以边读边等。想改就改，想停就停——创作的节奏永远在你手里，而不是被工具牵着走。",
    points: [
      "实时流式输出，无需等待全部生成完毕",
      "随时停止、编辑、继续，完全掌控进度",
    ],
    visualVariant: "warm" as const,
    visualText: "Screenshot Placeholder\n内容扩写界面预览",
    reverse: false,
  },
  {
    badge: { text: "Step 2 & 3 · 分镜与资产", variant: "sage" as const },
    headline: "智能标注，资产自动归位",
    desc: "画面描述里提到的人物、场景、物品，AI 自动识别并打上 @标签。一键生成资产信息，每个标签都变成有描述、有图片的角色或场景。",
    points: [
      "@人物@ @场景@ @物品@ 三类自动分类",
      "一键生成图片提示词，批量生成参考图",
    ],
    visualVariant: "sage" as const,
    visualText: "Screenshot Placeholder\n分镜表与资产管理界面预览",
    reverse: true,
  },
  {
    badge: { text: "Step 4 · 视频生成", variant: "gold" as const },
    headline: "视频提示词，画面一致性守护",
    desc: "每个镜头自动关联第三步生成的资产图片作为参考图，AI 生成的视频提示词保证角色外观一致——让分镜表里的小明，到视频里还是那个小明。",
    points: [
      "资产参考图自动关联，保证角色一致性",
      "批量生成或逐镜生成，灵活控制节奏",
    ],
    visualVariant: "gold" as const,
    visualText: "Screenshot Placeholder\n视频生成界面预览",
    reverse: false,
  },
];

function FeatureRow({ feature }: { feature: typeof FEATURES_DATA[0] }) {
  return (
    <div className={`feature-row ${feature.reverse ? "feature-row--reverse" : ""}`}>
      {/* Text content */}
      <div className="feature-content">
        <span className={`feature-badge feature-badge--${feature.badge.variant}`}>
          {feature.badge.text}
        </span>
        <h3 className="feature-headline">{feature.headline}</h3>
        <p className="feature-desc">{feature.desc}</p>
        <ul className="feature-points">
          {feature.points.map((point, i) => (
            <li key={i} className="feature-point">
              <CheckIcon className="feature-check" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Visual placeholder */}
      <div className={`feature-visual feature-visual--${feature.visualVariant}`}>
        <p className="feature-placeholder whitespace-pre-line">{feature.visualText}</p>
      </div>
    </div>
  );
}

function CoreFeatures() {
  return (
    <section id="features" className="section-block bg-white">
      <div className="mx-auto">
        <div className="section-header">
          <span className="section-label">核心能力</span>
          <h2 className="section-title">安稳创作，藏在这些细节里</h2>
        </div>

        <div>
          {FEATURES_DATA.map((feat, i) => (
            <FeatureRow key={i} feature={feat} />
          ))}
        </div>
      </div>
    </section>
  );
}


// ---- Footer Component ----

const FOOTER_LINKS = {
  product: { title: "产品", links: ["功能介绍", "更新日志", "使用指南"] },
  resource: { title: "资源", links: ["帮助文档", "社区论坛", "API 文档"] },
  company: { title: "公司", links: ["关于我们", "联系我们", "隐私政策"] },
};

function Footer() {
  return (
    <footer id="footer" className="footer-section">
      <div className="footer-top">
        {/* Brand column */}
        <div className="footer-brand">
          <div className="footer-logo">
            <div className="footer-logo-mark">
              <BrushIcon size={16} className="text-warm-950" />
            </div>
            <span className="footer-logo-text">墨间</span>
          </div>
          <p className="footer-tagline">
            安放你脑中的故事。<br />
            让创作回归安静与专注。
          </p>
        </div>

        {/* Link columns */}
        <div className="footer-links">
          {Object.values(FOOTER_LINKS).map((col) => (
            <div key={col.title} className="footer-col">
              <span className="footer-col-title">{col.title}</span>
              {col.links.map((link) => (
                <a key={link} href="#" className="footer-link">{link}</a>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="footer-bottom">
        <span className="footer-copyright">© 2026 墨间 · AI 剧本开发工具</span>
        <div className="footer-legal">
          <a href="#">服务条款</a>
          <a href="#">隐私政策</a>
        </div>
      </div>
    </footer>
  );
}


// ---- Main Page ----

export default function LandingPage() {
  const router = useRouter();
  const goCreate = () => router.push("/home");

  return (
    <main className="w-full min-w-[1440px]" style={{ backgroundColor: "#FFFBEB" }}>
      <Header onStart={goCreate} />
      <Hero onStart={goCreate} />
      <HowItWorks />
      <CoreFeatures />
      <Footer />
    </main>
  );
}
