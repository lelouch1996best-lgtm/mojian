import type { Metadata } from "next";
import "./globals.css";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

export const metadata: Metadata = {
  title: "墨间 · AI 剧本开发工具",
  description: "从故事到分镜，AI 辅助视频剧本创作。让故事安静地，长成视频。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}
