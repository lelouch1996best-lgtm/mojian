// LLM 配置（用户自配，存服务端数据库）
export interface LLMSettings {
  provider:
    | "deepseek"
    | "glm"
    | "mimo" // 小米 MiMo 按量付费
    | "mimo-plan" // 小米 MiMo Token Plan 套餐
    | "custom";
  baseURL: string; // 例: https://api.deepseek.com/v1
  apiKey: string;
  model: string; // 例: deepseek-chat, glm-4-plus, mimo-v2.5-pro
}

/** 世界设定（全局，存服务端数据库），用于故事续写和分镜生成的上下文 */
export interface WorldSettings {
  /** 故事背景 */
  background: string;
  /** 核心主题 */
  theme: string;
  /** 写作风格 */
  style: string;
}

/** 单个人物设定档案 —— 系列级，跨集共享。同一角色可有多个版本（如剧情发展中外貌/性格变化）。 */
export interface CharacterProfile {
  id: string;
  /** 人物组 ID（同一角色的多个版本共享此 ID） */
  characterId: string;
  /** 版本号（1, 2, 3...，越大越新） */
  version: number;
  /** 版本标签（如"少年期""觉醒后"） */
  versionLabel: string;
  /** 姓名 */
  name: string;
  /** 角色定位（主角/配角/反派等） */
  role: string;
  /** 性别年龄，如"男，25岁" */
  genderAge: string;
  /** 外貌描述 */
  appearance: string;
  /** 性格特点 */
  personality: string;
  /** 背景故事 */
  background: string;
  /** 人物关系 */
  relationships: string;
  /** 人物形象图 URL（未来扩展） */
  imageUrl?: string;
}

/** 单个物品设定档案 —— 系列级，跨集共享。同一物品可有多个版本（如不同形态/等级）。 */
export interface ObjectProfile {
  id: string;
  /** 物品组 ID（同一物品的多个版本共享此 ID） */
  objectId: string;
  /** 版本号（1, 2, 3...，越大越新） */
  version: number;
  /** 版本标签（如"初始形态""觉醒后"） */
  versionLabel: string;
  /** 名称 */
  name: string;
  /** 分类（武器/道具/载具等） */
  category: string;
  /** 外观描述 */
  appearance: string;
  /** 功能用途 */
  purpose: string;
  /** 来源背景 */
  origin: string;
  /** 物品形象图 URL */
  imageUrl?: string;
}

/** 单个场景设定档案 —— 系列级，跨集共享。同一场景可有多个版本（如白天/夜晚/战火后）。 */
export interface SceneProfile {
  id: string;
  /** 场景组 ID（同一场景的多个版本共享此 ID） */
  sceneId: string;
  /** 版本号（1, 2, 3...，越大越新） */
  version: number;
  /** 版本标签（如"白天""夜晚""破败后"） */
  versionLabel: string;
  /** 名称 */
  name: string;
  /** 分类（室内/室外/特定地点等） */
  category: string;
  /** 外观描述 */
  appearance: string;
  /** 光影氛围 */
  lightingMood: string;
  /** 来源背景 */
  origin: string;
  /** 场景形象图 URL */
  imageUrl?: string;
}

/** 剧集系列（企划）—— 每个系列下有独立的多集剧集、世界设定、漫剧风格 */
export interface Series {
  id: string;
  title: string;
  description: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  /** 世界设定 —— 每系列独立 */
  worldSettings: WorldSettings;
  /** 人物设定 —— 每系列独立，跨集共享 */
  characterSettings: CharacterProfile[];
  /** 物品设定 —— 每系列独立，跨集共享 */
  objectSettings: ObjectProfile[];
  /** 场景设定 —— 每系列独立，跨集共享 */
  sceneSettings: SceneProfile[];
  /** 漫剧风格配置 —— 每系列独立 */
  styleSettings: StyleSettings;
  /** 该系列下的剧集 ID 列表，决定顺序 */
  episodeOrder: string[];
}

/** 漫剧风格预设 —— 每种风格包含各类型资产的图片提示词模板和视频风格后缀 */
export interface StylePreset {
  id: string;
  name: string;
  description: string;
  /** 人物图片提示词模板（含三视图要求），拼接到 LLM 生成的 imagePrompt 末尾 */
  characterTemplate: string;
  /** 场景图片提示词模板 */
  sceneTemplate: string;
  /** 物品图片提示词模板 */
  objectTemplate: string;
  /** 视频提示词风格后缀 */
  videoStyleSuffix: string;
}

/** 风格配置（全局，存服务端数据库） */
export interface StyleSettings {
  selectedStyleId: string;
  /** 用户自定义覆盖（key = styleId） */
  overrides: Record<string, Partial<Omit<StylePreset, "id">>>;
}

/** 分镜表单行 —— 进号不存储，由数组下标 +1 派生 */
export interface Shot {
  id: string; // uuid，重排/删除时保持引用稳定
  duration: string; // 时长（可编辑）— "3-5秒"
  visualDescription: string; // 画面描述（可编辑）
  shotType: string; // 景别（可编辑）— 特写/近景/中景/全景/远景
  lightingMood: string; // 光影氛围（可编辑）
  dialogueVoiceover: string; // 对白旁白（可编辑）
  soundEffects: string; // 音效（可编辑）
  cameraMovement: string; // 运镜（可编辑）— 推/拉/摇/移/跟/固定
  finalPrompt: string; // Step4 视频提示词（AI 生成，可编辑）
  videoUrl: string; // 生成的视频 URL（mp4，24h 有效）
  videoStatus: VideoStatus; // 视频生成状态
  videoTaskId: string; // 视频生成任务 ID（用于轮询）
  /** 该镜头关联的资产 ID 列表（由 @ 补全自动添加，用户可手动解除关联） */
  relatedAssetIds: string[];
  /** 卡片级视频配置；缺省时回退 DEFAULT_SHOT_VIDEO_CONFIG */
  videoConfig?: ShotVideoConfig;
}

/** 资产类型 */
export type AssetType = "character" | "scene" | "object";

/** 资产生成状态 */
export type AssetStatus = "pending" | "ready" | "failed";

/** Step3 资产 —— 由 Step2 标注的 @标签 派生 */
export interface Asset {
  id: string;
  name: string; // @标签 内的名字，如 "小明"
  type: AssetType; // 人物/场景/物品
  description: string; // LLM 生成的资产描述
  imagePrompt: string; // 图片生成提示词（中文，LLM 生成）
  imageUrl: string; // 生成的图片 URL（暂空，待接入图片 API）
  status: AssetStatus;
}

export interface Episode {
  id: string;
  title: string;
  seriesId: string; // 所属系列 ID
  createdAt: number;
  updatedAt: number;
  step: 1 | 2 | 3 | 4; // 当前步骤
  originalContent: string; // Step1 原始输入
  expandedContent: string; // Step1 扩写结果（可编辑）
  shots: Shot[]; // Step2 分镜数组
  assets: Asset[]; // Step3 资产数组
}

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** 前端发给 /api/llm 的请求体 */
export interface LLMProxyRequest {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  stream: boolean;
  temperature?: number;
  responseFormat?: "json_object" | "text";
}

/** 从 LLM 返回的原始分镜对象（无 id / finalPrompt） */
export interface RawShot {
  duration?: string;
  visualDescription?: string;
  shotType?: string;
  lightingMood?: string;
  dialogueVoiceover?: string;
  soundEffects?: string;
  cameraMovement?: string;
}

/** 图片生成 API 配置（火山引擎 Seedream / Doubao）— 独立于 LLM 设置 */
export interface ImageGenSettings {
  apiKey: string; // 火山方舟 API Key
  baseURL: string; // 例: https://ark.cn-beijing.volces.com/api/v3
  model: string; // 模型 ID，如 doubao-seedream-5-0-260128
  size: string; // 2K / 3K / 4K 或 2048x2048
  outputFormat: "png" | "jpeg";
  watermark: boolean;
  responseFormat: "url" | "b64_json";
}

/** 前端发给 /api/image 的请求体 */
export interface ImageProxyRequest {
  apiKey: string;
  baseURL: string;
  model: string;
  prompt: string;
  size?: string;
  outputFormat?: "png" | "jpeg";
  watermark?: boolean;
  responseFormat?: "url" | "b64_json";
}

/** /api/image 非流式响应 */
export interface ImageProxyResponse {
  imageUrl: string; // 图片 URL 或 data:image/...;base64,... 形式
  size?: string;
  model?: string;
}

/** 腾讯云 COS 配置 */
export interface CosSettings {
  secretId: string;
  secretKey: string;
  bucket: string; // 格式：BucketName-APPID，如 my-bucket-1250000000
  region: string; // 如 ap-guangzhou
  /** 自定义域名（CDN 加速域名），可选；填写后优先使用 */
  customDomain?: string;
}

/** 视频生成状态 */
export type VideoStatus =
  | "idle" // 未生成
  | "queued" // 排队中
  | "running" // 生成中
  | "succeeded" // 成功
  | "failed" // 失败
  | "expired" // 超时
  | "cancelled"; // 已取消

/** 视频生成模式 */
export type VideoGenerationMode =
  | "text2video" // 文生视频
  | "first-frame" // 图生视频-首帧
  | "first-last-frame" // 图生视频-首尾帧
  | "multimodal-ref"; // 多模态参考生视频（仅 2.0）

export type VideoResolution = "480p" | "720p" | "1080p";
export type VideoRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9" | "adaptive";

/** 单个镜头的视频生成配置（卡片级，覆盖硬编码默认） */
export interface ShotVideoConfig {
  model: string;
  mode: VideoGenerationMode;
  resolution: VideoResolution;
  ratio: VideoRatio;
  duration: number; // -1 = 模型自动（仅支持的模型）
  watermark: boolean;
  generateAudio: boolean;
  /** multimodal-ref 模式：参考视频 URL（仅 2.0） */
  referenceVideoUrls?: string[];
  /** multimodal-ref 模式：参考音频 URL（仅 2.0） */
  referenceAudioUrls?: string[];
  /** first-frame / first-last-frame 模式：首帧图 URL（单独上传） */
  firstFrameImageUrl?: string;
  /** first-last-frame 模式：尾帧图 URL（单独上传） */
  lastFrameImageUrl?: string;
}

/** 视频生成 API 配置（火山引擎 Seedance / Doubao） */
export interface VideoGenSettings {
  apiKey: string; // 火山方舟 API Key（与图片 API 共用同一 Key）
  baseURL: string; // https://ark.cn-beijing.volces.com/api/v3
}

/** 前端发给 /api/video/create 的请求体 */
export interface VideoCreateProxyRequest {
  apiKey: string;
  baseURL: string;
  model: string;
  prompt: string;
  mode: VideoGenerationMode;
  /** 首帧图片 URL（first-frame / first-last-frame 模式） */
  firstFrameUrl?: string;
  /** 尾帧图片 URL（first-last-frame 模式） */
  lastFrameUrl?: string;
  /** 参考图片 URL 列表（multimodal-ref 模式，role=reference_image） */
  referenceImageUrls?: string[];
  /** 参考视频 URL 列表（multimodal-ref 模式，仅 2.0） */
  referenceVideoUrls?: string[];
  /** 参考音频 URL 列表（multimodal-ref 模式，仅 2.0） */
  referenceAudioUrls?: string[];
  resolution?: VideoResolution;
  ratio?: VideoRatio;
  duration?: number;
  watermark?: boolean;
  generateAudio?: boolean;
}

/** /api/video/create 响应 */
export interface VideoCreateProxyResponse {
  taskId: string;
}

/** 前端发给 /api/video/query 的请求体 */
export interface VideoQueryProxyRequest {
  apiKey: string;
  baseURL: string;
  taskId: string;
}

/** /api/video/query 响应 */
export interface VideoQueryProxyResponse {
  status: VideoStatus;
  videoUrl?: string;
  error?: string;
}
