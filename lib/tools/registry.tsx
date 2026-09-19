import type { ComponentType, ReactNode } from "react";
import SuperResolutionTool from "@/components/tools/super-resolution/SuperResolutionTool";
import OutfitChangeTool from "@/components/tools/outfit-change/OutfitChangeTool";
import ImageInpaintTool from "@/components/tools/image-inpaint/ImageInpaintTool";
import MiniMaxVideoTool from "@/components/tools/minimax-video/MiniMaxVideoTool";
import ZImageTool from "@/components/tools/z-image/ZImageTool";

/** 工具分类枚举 */
export type ToolCategory = "video" | "image" | "audio" | "text" | "utility";

/** 工具来源：RunningHub 云端工作流 / 本地 ComfyUI 直连 */
export type ToolSource = "runninghub" | "local";

/** 工具定义 */
export interface ToolDefinition {
  /** 唯一 id，用作 URL 段：/tools/<id> */
  id: string;
  /** 显示名 */
  name: string;
  /** 一句话描述（卡片副标题） */
  description: string;
  category: ToolCategory;
  /** 执行来源（云端 / 本地），工具页页签按此区分 */
  source: ToolSource;
  /** 内联 SVG icon（与首页按钮风格一致） */
  icon: ReactNode;
  /** 语义化版本号，未来灰度/兼容用 */
  version: string;
  /** 是否启用（可做灰度开关） */
  enabled: boolean;
  /** 角标（如"新"/"Beta"），可选 */
  badge?: string;
  /** 工具实现组件（"use client"），无 props，自管状态 */
  Component: ComponentType;
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  video: "视频",
  image: "图片",
  audio: "音频",
  text: "文本",
  utility: "实用工具",
};

export const SOURCE_LABELS: Record<ToolSource, string> = {
  runninghub: "RunningHub 云端",
  local: "本地 ComfyUI",
};

function SparklesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9L19 14z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SuperResIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3 14l4-4 3 3 3-4 4 5 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 3l.5 1.5L20 5l-1.5.5L18 7l-.5-1.5L16 5l1.5-.5L18 3z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OutfitChangeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      {/* 衣服轮廓 */}
      <path
        d="M9 4l3 2 3-2 4 2.5-1.5 4L16 10v9H8v-9l-1.5.5L5 6.5 9 4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* 魔法星点 */}
      <path
        d="M19 14.5l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InpaintIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      {/* 图片框 */}
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      {/* 画笔 */}
      <path
        d="M14.5 6.5l3 3L9 18l-3.5.5L6 15l8.5-8.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* 涂抹点 */}
      <path
        d="M19.5 14l.3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3.3-.9z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MiniMaxVideoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      {/* 场记板主体 */}
      <rect x="3" y="9" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
      {/* 顶盖 */}
      <path
        d="M3.5 9L5 4.5l15 3-.5 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* 播放三角 */}
      <path d="M10.5 12.5l4 2-4 2v-4z" fill="currentColor" />
    </svg>
  );
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    id: "super-resolution",
    name: "视频超分",
    description: "基于 RunningHub 云端 ComfyUI 工作流，将视频提升至 2x/3x/4x 分辨率",
    category: "video",
    source: "runninghub",
    icon: <SuperResIcon />,
    version: "1.0.0",
    enabled: true,
    badge: "新",
    Component: SuperResolutionTool,
  },
  {
    id: "outfit-change",
    name: "AI 换装",
    description: "上传人物图与服装图，让人物穿上指定衣服（RunningHub 云端工作流）",
    category: "image",
    source: "runninghub",
    icon: <OutfitChangeIcon />,
    version: "1.0.0",
    enabled: true,
    badge: "新",
    Component: OutfitChangeTool,
  },
  {
    id: "image-inpaint",
    name: "图片局部编辑",
    description: "涂抹图片局部区域，用提示词修改画面内容（RunningHub 云端工作流）",
    category: "image",
    source: "runninghub",
    icon: <InpaintIcon />,
    version: "1.0.0",
    enabled: true,
    badge: "新",
    Component: ImageInpaintTool,
  },
  {
    id: "minimax-video",
    name: "视频生成（MiniMax H3）",
    description: "文生 / 首尾帧 / 全能参考（图·视频·音频）三模式，动态拼图直连本地 ComfyUI 生成带原生音轨的视频",
    category: "video",
    source: "local",
    icon: <MiniMaxVideoIcon />,
    version: "1.0.0",
    enabled: true,
    badge: "新",
    Component: MiniMaxVideoTool,
  },
  {
    id: "z-image",
    name: "文生图片（Z-Image Turbo）",
    description: "提示词生成图片，Turbo 蒸馏 8 步极速出图（直连本地 ComfyUI，需本机运行）",
    category: "image",
    source: "local",
    icon: <SparklesIcon />,
    version: "1.0.0",
    enabled: true,
    badge: "新",
    Component: ZImageTool,
  },
  // ← 后续新工具在此追加一项即可
];

export const getToolById = (id: string) => TOOL_REGISTRY.find((t) => t.id === id && t.enabled);

export const getToolsByCategory = (c: ToolCategory) =>
  TOOL_REGISTRY.filter((t) => t.category === c && t.enabled);

export const getEnabledTools = () => TOOL_REGISTRY.filter((t) => t.enabled);
