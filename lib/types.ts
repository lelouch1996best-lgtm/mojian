// LLM 配置（用户自配，存服务端数据库）
export interface LLMSettings {
  provider:
    | "deepseek"
    | "glm"
    | "mimo" // 小米 MiMo 按量付费
    | "mimo-plan" // 小米 MiMo Token Plan 套餐
    | "ark" // 火山方舟（豆包 Doubao）
    | "ark-agent-plan" // 火山方舟 Agent Plan（订阅套餐）
    | "apimart" // APIMart 聚合对话 API
    | "custom";
  baseURL: string; // 例: https://api.deepseek.com/v1
  apiKey: string;
  model: string; // 例: deepseek-chat, glm-4-plus, mimo-v2.5-pro
}

/** 单个服务商缓存的配置（切换服务商时保存，切回时恢复，避免自定义配置丢失） */
export interface ProviderCacheEntry {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/** 各服务商缓存配置表：provider -> 缓存条目 */
export type ProviderCache = Record<string, ProviderCacheEntry>;

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
  /** 参考图 URL 列表（COS URL，用于图片生成时引用，持久化到设定数据） */
  referenceImages?: string[];
  /** 音色音频 URL（COS 持久 URL） */
  voiceUrl?: string;
  /** 音色设计描述（voicedesign 用，便于复用/再生成） */
  voicePrompt?: string;
  /** 生成音色所用的模型 */
  voiceModel?: string;
  /** 预置音色 ID 或复刻来源标记 */
  voiceId?: string;
  /** 异步图片生成任务 ID（支持轮询的供应商用，切页/刷新后可恢复轮询） */
  imageTaskId?: string;
  /** 创建该图片任务时使用的供应商（恢复轮询时按此选择凭证；旧数据缺省时回退当前设置） */
  imageTaskProvider?: ImageGenSettings["provider"];
}

/** 单个物品设定档案 -- 系列级，跨集共享。同一物品可有多个版本（如不同形态/等级）。 */
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
  /** 参考图 URL 列表（COS URL，用于图片生成时引用，持久化到设定数据） */
  referenceImages?: string[];
  /** 异步图片生成任务 ID（支持轮询的供应商用，切页/刷新后可恢复轮询） */
  imageTaskId?: string;
  /** 创建该图片任务时使用的供应商（恢复轮询时按此选择凭证；旧数据缺省时回退当前设置） */
  imageTaskProvider?: ImageGenSettings["provider"];
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
  /** 参考图 URL 列表（COS URL，用于图片生成时引用，持久化到设定数据） */
  referenceImages?: string[];
  /** 异步图片生成任务 ID（支持轮询的供应商用，切页/刷新后可恢复轮询） */
  imageTaskId?: string;
  /** 创建该图片任务时使用的供应商（恢复轮询时按此选择凭证；旧数据缺省时回退当前设置） */
  imageTaskProvider?: ImageGenSettings["provider"];
}

/** 剧集系列（企划）—— 每个系列下有独立的多集剧集、世界设定、风格设定 */
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
  /** 风格设定配置 —— 每系列独立 */
  styleSettings: StyleSettings;
  /** 该系列下的剧集 ID 列表，决定顺序 */
  episodeOrder: string[];
}

/** 风格设定预设 -- 每种风格包含各类型资产的图片提示词模板 */
export interface StylePreset {
  id: string;
  name: string;
  description: string;
  /** 人物图片提示词模板（含三视图要求），拼接到 description（用作图片提示词）末尾 */
  characterTemplate: string;
  /** 场景图片提示词模板 */
  sceneTemplate: string;
  /** 物品图片提示词模板 */
  objectTemplate: string;
  /** 故事板图片提示词模板（可含 {镜头信息} 占位符，生成时替换为当前镜头信息块） */
  storyboardTemplate: string;
  /** 人物参考图 URL（COS 持久 URL，生图时作为图片1风格参考） */
  characterReferenceImage?: string;
  /** 场景参考图 URL（生图时作为图片1风格参考） */
  sceneReferenceImage?: string;
  /** 物品参考图 URL（生图时作为图片1风格参考） */
  objectReferenceImage?: string;
  /** 各参考图进行中的异步生图任务 ID（切页/刷新后恢复轮询用，完成后清空） */
  characterRefImageTaskId?: string;
  sceneRefImageTaskId?: string;
  objectRefImageTaskId?: string;
  /** 各参考图生图任务的供应商（按创建任务时的供应商路由凭证恢复轮询） */
  characterRefImageTaskProvider?: ImageGenSettings["provider"];
  sceneRefImageTaskProvider?: ImageGenSettings["provider"];
  objectRefImageTaskProvider?: ImageGenSettings["provider"];
}

/** 风格配置（全局，存服务端数据库） */
export interface StyleSettings {
  selectedStyleId: string;
}

/** 分镜表单行 —— 进号不存储，由数组下标 +1 派生 */
export interface Shot {
  id: string; // uuid，重排/删除时保持引用稳定
  duration: string; // 时长（可编辑）- 如 "8秒"
  visualDescription: string; // 画面描述（可编辑）
  shotType: string; // 景别（可编辑）— 特写/近景/中景/全景/远景
  lightingMood: string; // 光影氛围（可编辑）
  dialogueVoiceover: string; // 对白旁白（可编辑）
  soundEffects: string; // 音效（可编辑）
  cameraMovement: string; // 运镜（可编辑）— 推/拉/摇/移/跟/固定
  finalPrompt: string; // Step4 视频提示词（AI 生成，可编辑）
  videoUrl: string; // 生成的视频 URL（mp4，24h 有效）
  videoStatus: VideoStatus; // 视频生成状态
  /** 视频生成失败/超时时的错误原因（供错误标签悬浮展示；非错误状态时清除） */
  videoError?: string;
  videoTaskId: string; // 视频生成任务 ID（用于轮询）
  /** 创建该视频任务时使用的供应商（恢复轮询时按此选择查询端点与凭证；旧数据缺省时回退当前设置） */
  videoTaskProvider?: VideoGenSettings["provider"];
  /** 该镜头关联的资产 ID 列表（由 @ 补全自动添加，用户可手动解除关联） */
  relatedAssetIds: string[];
  /** 卡片级视频配置；缺省时回退 DEFAULT_SHOT_VIDEO_CONFIG */
  videoConfig?: ShotVideoConfig;
  /** 镜头故事板图片 URL（专业影视分镜，COS 持久 URL） */
  storyboardUrl?: string;
  /** 故事板图片生成任务 ID（支持轮询的供应商用，刷新/切页后可恢复轮询） */
  imageTaskId?: string;
  /** 创建该故事板图片任务时使用的供应商（恢复轮询时按此选择凭证；旧数据缺省时回退当前设置） */
  imageTaskProvider?: ImageGenSettings["provider"];
  /** 该图片任务的类型（恢复轮询时按此区分完成处理：storyboard 写故事板+入库；genImage 仅加入参考图；旧数据缺省视为 storyboard） */
  imageTaskKind?: "storyboard" | "genImage";
}

/** 资产类型 */
export type AssetType = "character" | "scene" | "object" | "screenshot" | "storyboard" | "generated";

/** 资产生成状态 */
export type AssetStatus = "pending" | "ready" | "failed";

/** Step3 资产 —— 由 Step2 标注的 @标签 派生 */
export interface Asset {
  id: string;
  name: string; // @标签 内的名字，如 "小明"
  type: AssetType; // 人物/场景/物品
  description: string; // 资产外观描述，同时用作图片生成提示词
  imageUrl: string; // 生成的图片 URL（暂空，待接入图片 API）
  status: AssetStatus;
  /** 异步图片生成任务 ID（支持轮询的供应商用，刷新页面后可恢复轮询） */
  imageTaskId?: string;
  /** 创建该图片任务时使用的供应商（恢复轮询时按此选择凭证；旧数据缺省时回退当前设置） */
  imageTaskProvider?: ImageGenSettings["provider"];
  /** 卡片级图片生成配置；缺省时回退 DEFAULT_ASSET_IMAGE_CONFIG */
  imageConfig?: AssetImageConfig;
  /** 故事板资产关联的镜头 ID（仅在 type === "storyboard" 时使用） */
  shotId?: string;
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

/** AI 扩写可选的前序剧集上下文（由剧集页计算，供扩写弹窗勾选） */
export interface PreviousEpisodeContext {
  id: string;
  /** 在系列中的真实集序（从 1 开始） */
  orderIndex: number;
  title: string;
  /** 该集的扩写内容（已 trim，保证非空） */
  content: string;
}

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** 前端发给 /api/llm 的请求体 */
/** 发送给 LLM 上游 API（OpenAI 兼容格式）的完整请求体（前端构造，后端透传） */
export interface LLMUpstreamPayload {
  model: string;
  messages: LLMMessage[];
  stream: boolean;
  temperature: number;
  response_format?: { type: "json_object" };
}

/** 前端发给 /api/llm 的请求体（前端已构造好完整上游 payload） */
export interface LLMProxyRequest {
  apiKey: string;
  baseURL: string;
  /** 完整的上游请求体（前端构造，直接透传给 LLM API） */
  payload: LLMUpstreamPayload;
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

/** 图片生成 API 配置（多供应商，全局仅管理供应商和模型，生成参数在卡片级配置） */
export interface ImageGenSettings {
  provider: "ark" | "ark-plan" | "apimart" | "custom";
  baseURL: string;
  apiKey: string;
  model: string;
}

/** 单个资产的图片生成配置（卡片级，参照 ShotVideoConfig 模式） */
export interface AssetImageConfig {
  /** 图片生成模型（卡片级选择，缺省回退 DEFAULT_ASSET_IMAGE_CONFIG.model） */
  model: string;
  /** 该模型所属供应商（生成时按此路由 API Key / baseURL；缺省回退当前激活供应商） */
  provider?: ImageGenSettings["provider"];
  /** 分辨率档位（方式2）：1K/2K/3K/4K，通过 size 字段传输 */
  resolution: string;
  /** 宽高比（方式2）：1:1/4:3/3:4/16:9/9:16/3:2/2:3/21:9，拼接到提示词中 */
  aspectRatio: string;
  outputFormat: "png" | "jpeg";
  watermark: boolean;
  responseFormat: "url" | "b64_json";
  /** 是否开启联网搜索（tools.web_search） */
  webSearch: boolean;
  /** 提示词优化模式（optimize_prompt_options.mode） */
  optimizePromptMode: "standard" | "fast";
  /** 画质（quality，仅 gpt-image-2）：low/medium/high/auto */
  quality?: "low" | "medium" | "high" | "auto";
  /** 参考图 URL 列表（COS URL，用于持久化） */
  referenceImages?: string[];
}

/** 前端发给 /api/image 的请求体 */
export interface ImageProxyRequest {
  provider: ImageGenSettings["provider"];
  apiKey: string;
  baseURL: string;
  model: string;
  prompt: string;
  size?: string;
  /** APIMart 分辨率档位（1k/2k/4k），与 size(比例) 正交 */
  resolution?: string;
  outputFormat?: "png" | "jpeg";
  watermark?: boolean;
  responseFormat?: "url" | "b64_json";
  /** 参考图列表（URL 或 base64 data URI），用于单图/多图生图 */
  images?: string[];
  /** 是否开启联网搜索 */
  webSearch?: boolean;
  /** 提示词优化模式 */
  optimizePromptMode?: "standard" | "fast";
  /** 画质（quality，仅 gpt-image-2） */
  quality?: string;
  /** 异步模式（供应商支持轮询时，前端设为 true，路由返回 jobId 而非 imageUrl） */
  asyncMode?: boolean;
  /** 异步任务完成后的 COS 转存 key 前缀（服务端任务中心使用），默认 ai-script/assets */
  cosPrefix?: string;
}

/** /api/image 非流式响应 */
export interface ImageProxyResponse {
  imageUrl: string; // 图片 URL 或 data:image/...;base64,... 形式
  size?: string;
  model?: string;
}

/** /api/image 异步模式响应（供应商支持轮询时返回） */
export interface ImageAsyncCreateResponse {
  /** 异步任务 ID，用于后续轮询 */
  jobId: string;
  /** 初始状态 */
  status: string;
}

/** 前端发给 /api/image/query 的请求体 */
export interface ImageQueryProxyRequest {
  provider: ImageGenSettings["provider"];
  apiKey: string;
  baseURL: string;
  jobId: string;
}

/** 图片任务状态 */
export type ImageTaskStatus = "pending" | "running" | "done" | "failed" | "expired";

/** /api/image/query 响应体 */
export interface ImageQueryProxyResponse {
  status: ImageTaskStatus;
  /** 成功时的图片 URL（done 状态） */
  imageUrl?: string;
  /** 失败时的错误信息 */
  error?: string;
}

/** 服务端 image_tasks 表记录（API 响应层已脱敏，不含 api_key） */
export interface ImageTaskRecord {
  jobId: string;
  provider: ImageGenSettings["provider"];
  baseURL: string;
  model: string;
  cosPrefix: string;
  status: ImageTaskStatus;
  /** 最终结果 URL（done 状态；COS 转存成功则为 COS URL，否则为上游原始 URL） */
  imageUrl?: string;
  /** 上游原始图片 URL */
  upstreamUrl?: string;
  error?: string;
  failCount: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
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

export type VideoResolution = "480p" | "720p" | "1080p" | "4k" | "2K" | "720P" | "1080P";
export type VideoRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "21:9" | "adaptive" | "3:2" | "2:3";

/** 单个镜头的视频生成配置（卡片级，覆盖硬编码默认） */
export interface ShotVideoConfig {
  model: string;
  /** 该模型所属供应商（生成时按此路由 API Key / baseURL；缺省回退当前激活供应商） */
  provider?: VideoGenSettings["provider"];
  mode: VideoGenerationMode;
  resolution: VideoResolution;
  ratio: VideoRatio;
  duration: number; // -1 = 模型自动（仅支持的模型）
  watermark: boolean;
  generateAudio: boolean;
  /** 种子，-1 = 随机（Seedance 2.0 系列不支持） */
  seed: number;
  /** 是否固定摄像头（Seedance 2.0 系列、参考图场景不支持） */
  cameraFixed: boolean;
  /** 是否返回尾帧图像（用于连续生成多个视频） */
  returnLastFrame: boolean;
  /** 是否开启联网搜索（仅 Seedance 2.0 系列） */
  webSearch: boolean;
  /** 请求优先级 0-9（仅 Seedance 2.0 系列，越大越优先） */
  priority: number;
  /** 是否开启样片模式（仅 Seedance 1.5 Pro） */
  draft: boolean;
  /** multimodal-ref 模式：参考视频 URL（仅 2.0，支持 asset:// 素材） */
  referenceVideoUrls?: string[];
  /** multimodal-ref 模式：参考音频 URL（仅 2.0，支持 asset:// 素材） */
  referenceAudioUrls?: string[];
  /** multimodal-ref 模式：手动添加的参考图 URL（asset:// 素材或公网 URL，与关联资产图合并） */
  referenceImageAssetUrls?: string[];
  /** multimodal-ref 模式：手动添加的参考图名称（与 referenceImageAssetUrls 一一对应；本地上传为"参考图N"，资产库/故事板为原始名，缺省时回退"参考图N"） */
  referenceImageAssetNames?: string[];
  /** first-frame / first-last-frame 模式：首帧图 URL（单独上传） */
  firstFrameImageUrl?: string;
  /** first-last-frame 模式：尾帧图 URL（单独上传） */
  lastFrameImageUrl?: string;
}

/** 视频生成 API 配置（多供应商） */
export interface VideoGenSettings {
  provider: "ark" | "ark-plan" | "apimart" | "custom";
  apiKey: string; // API Key
  baseURL: string; // https://ark.cn-beijing.volces.com/api/v3
}

/** 音频生成（TTS）API 配置（多供应商） */
export interface AudioGenSettings {
  provider: "mimo" | "custom";
  apiKey: string;
  baseURL: string; // https://api.xiaomimimo.com/v1
}

/** 音频（TTS）模型能力描述 */
export interface AudioModelCapability {
  /** 支持预置音色（mimo-v2.5-tts） */
  supportsPresetVoice: boolean;
  /** 支持文本设计音色（mimo-v2.5-tts-voicedesign） */
  supportsVoiceDesign: boolean;
  /** 支持音频样本复刻音色（mimo-v2.5-tts-voiceclone） */
  supportsVoiceClone: boolean;
  /** 支持唱歌模式（仅 mimo-v2.5-tts） */
  supportsSinging: boolean;
}

/** 前端发给 /api/audio 的请求体（前端已构造好完整上游 payload） */
export interface AudioProxyRequest {
  apiKey: string;
  baseURL: string;
  /** 完整的上游请求体（前端构造，直接透传给 mimo chat/completions） */
  payload: Record<string, unknown>;
}

/** /api/audio 响应 */
export interface AudioProxyResponse {
  audioBase64: string;
  format: string;
}

/** generateVoice 生成结果 */
export interface VoiceGenResult {
  voiceUrl: string;
  voicePrompt: string;
  voiceModel: string;
  voiceId: string;
}

/** 音乐生成 API 配置（多供应商） */
export interface MusicGenSettings {
  provider: "apimart" | "custom";
  apiKey: string;
  baseURL: string; // https://api.apib.ai/v1
  model: string; // suno
}

/** 音乐生成模式 */
export type MusicMode = "inspiration" | "custom" | "remix";

/** 音乐生成状态 */
export type MusicStatus = "idle" | "pending" | "completed" | "failed";

/** 音乐模型版本 */
export type MusicVersion =
  | "v3.5"
  | "v4"
  | "v4.5"
  | "v4.5+"
  | "v4.5-all"
  | "v5"
  | "v5.5";

/** 单个模式的生成参数（并集；各模式仅使用自身相关字段）
 *  - 灵感模式：用 `prompt`（灵感提示词）
 *  - 自定义 / 二次创作：用 `lyrics`（歌词）
 */
export interface MusicModeParams {
  prompt?: string; // 灵感提示词（灵感模式）
  lyrics?: string; // 歌词（自定义 / 二次创作）
  tags?: string; // 风格标签
  negativeTags?: string;
  title?: string;
  instrumental?: boolean; // 是否纯音乐
  vocalGender?: "m" | "f";
  styleWeight?: number; // 0-1
  weirdnessConstraint?: number; // 0-1
  audioWeight?: number; // 0-1
  /** 对输入歌词进行二次创作（custom / inspo 生效） */
  autoLyrics?: boolean;
  /** Persona 风格 id（仅 custom 生效） */
  personaId?: string;
  version: MusicVersion;
}

/** 音乐生成参数 -- 三种模式各自独立存储，切换模式互不污染 */
export interface MusicParams {
  inspiration: MusicModeParams;
  custom: MusicModeParams;
  remix: MusicModeParams;
}

/** 二次创作源 */
export interface MusicSource {
  type: "asset" | "url" | "upload";
  assetId?: string;
  url?: string;
  fileName?: string;
  sunoTaskId?: string;
  audioIndex?: number;
}

/** 单个音乐音轨（audioUrl/coverUrl 为 COS 持久地址） */
export interface MusicTrack {
  audioIndex: number;
  title: string;
  audioUrl: string;
  coverUrl?: string;
  duration?: number;
  lyrics?: string;
  tags?: string;
}

/** 音乐记录 */
export interface Music {
  id: string;
  seriesId: string; // 所属系列 ID
  title: string;
  mode: MusicMode;
  status: MusicStatus;
  error?: string;
  params: MusicParams;
  source?: MusicSource;
  sunoTaskId?: string;
  tracks: MusicTrack[];
  createdAt: number;
  updatedAt: number;
}

/** 前端发给 /api/music/create 的请求体 */
export interface MusicCreateProxyRequest {
  action: "generate" | "inspo" | "lyrics" | "createVoice";
  baseURL: string;
  apiKey: string;
  /** 完整的上游请求体（前端构造，直接透传） */
  payload: Record<string, unknown>;
}

/** /api/music/create 响应 */
export interface MusicCreateProxyResponse {
  taskId: string;
}

/** 前端发给 /api/music/query 的请求体 */
export interface MusicQueryProxyRequest {
  baseURL: string;
  apiKey: string;
  taskId: string;
}

/** /api/music/query 响应 */
export interface MusicQueryProxyResponse {
  status: "pending" | "completed" | "failed";
  progress?: number;
  music?: Array<{
    audioId?: string;
    title?: string;
    duration?: number;
    lyrics?: string;
    tags?: string;
    audioUrl?: string;
    imageUrl?: string;
    videoUrl?: string;
  }>;
  lyrics?: string;
  lyricsTitle?: string;
  lyricsTags?: string;
  /** createVoice 任务完成后的 persona_id */
  personaId?: string;
  error?: string;
  rawResult?: unknown;
}

/** Seedance API content 数组项 */
export interface VideoContentItem {
  type: "text" | "image_url" | "video_url" | "audio_url";
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: "first_frame" | "last_frame" | "reference_image" | "reference_video" | "reference_audio";
}

/** 发送给 Seedance API 的完整请求体（前端构造，后端透传） */
export interface VideoUpstreamPayload {
  model: string;
  content: VideoContentItem[];
  watermark?: boolean;
  resolution?: string;
  ratio?: string;
  duration?: number;
  generate_audio?: boolean;
  seed?: number;
  camera_fixed?: boolean;
  return_last_frame?: boolean;
  draft?: boolean;
  priority?: number;
  tools?: Array<{ type: "web_search" }>;
}

/** 发送给 APIMart 视频生成 API 的请求体（扁平结构） */
export interface VideoApimartUpstreamPayload {
  model: string;
  prompt: string;
  /** 宽高比，如 "16:9" */
  size?: string;
  /** 480p/720p/1080p/4k（Seedance 2.0 系列） */
  resolution?: string;
  /** 视频质量，480p/720p（Grok Imagine 1.5，与 resolution 互斥） */
  quality?: string;
  duration?: number;
  seed?: number;
  generate_audio?: boolean;
  return_last_frame?: boolean;
  /** 是否添加 AIGC 水印（MiniMax-H3 支持） */
  watermark?: boolean;
  tools?: Array<{ type: "web_search" }>;
  /** 参考图片 URL 数组（图生视频，与 image_with_roles 互斥） */
  image_urls?: string[];
  /** 带角色的图片数组（指定首帧/尾帧/参考人像，与 image_urls 互斥） */
  image_with_roles?: Array<{ url: string; role: "first_frame" | "last_frame" | "reference_image" }>;
  /** 参考视频 URL 数组（多模态参考） */
  video_urls?: string[];
  /** 参考音频 URL 数组（多模态参考） */
  audio_urls?: string[];
}

/** 前端发给 /api/video/create 的请求体（前端已构造好完整上游 payload） */
export interface VideoCreateProxyRequest {
  provider: VideoGenSettings["provider"];
  apiKey: string;
  baseURL: string;
  /** 完整的上游请求体（前端构造，按 provider 选择 ark content[] 或 APIMart 扁平结构） */
  payload: VideoUpstreamPayload | VideoApimartUpstreamPayload;
}

/** /api/video/create 响应 */
export interface VideoCreateProxyResponse {
  taskId: string;
  /** 实际使用的供应商，供前端持久化到 Shot.videoTaskProvider */
  provider?: VideoGenSettings["provider"];
}

/** 前端发给 /api/video/query 的请求体 */
export interface VideoQueryProxyRequest {
  provider: VideoGenSettings["provider"];
  apiKey: string;
  baseURL: string;
  taskId: string;
}

/** /api/video/query 响应 */
export interface VideoQueryProxyResponse {
  status: VideoStatus;
  videoUrl?: string;
  /** 视频尾帧图像 URL（仅当请求 return_last_frame=true 时返回） */
  lastFrameUrl?: string;
  error?: string;
}

/** 资产库聚合项 -- 由后端从 series/episodes 聚合而来，供全局资产库展示 */
export interface AssetLibraryItem {
  /** 唯一键，由来源派生（如 `asset-{epId}-{assetId}`） */
  id: string;
  mediaType: "image" | "video" | "audio" | "music" | "voice";
  /** 图片/视频 URL（COS 持久 URL） */
  url: string;
  seriesId: string;
  seriesTitle: string;
  /** 剧集级媒体才有 */
  episodeId?: string;
  episodeTitle?: string;
  entityType: "character" | "scene" | "object" | "shot" | "screenshot" | "storyboard";
  /** 人物/物品/场景名，或分镜画面描述 */
  entityName: string;
  source: "asset" | "shot" | "profile-character" | "profile-object" | "profile-scene";
  /** description / finalPrompt */
  prompt?: string;
  /** 排序用，取所在 episode/series 的 updatedAt */
  createdAt: number;
}

/** 媒体资产记录（独立账本，与 series/episodes 无外键关联） */
export interface MediaAsset {
  id: string;
  mediaType: "image" | "video" | "audio" | "music" | "voice";
  url: string;
  entityType: "character" | "scene" | "object" | "shot" | "screenshot" | "storyboard" | "generated" | "music" | "voicePersona" | "other";
  entityName: string;
  prompt: string;
  source: "asset" | "shot" | "profile-character" | "profile-object" | "profile-scene" | "manual" | "screenshot" | "generated" | "music" | "voicePersona";
  /** 来源企划 ID（纯文本标注，非外键） */
  seriesId: string;
  seriesTitle: string;
  episodeId: string;
  episodeTitle: string;
  /** 记录创建时间（媒体真实入库时间） */
  createdAt: number;
  updatedAt: number;
}

/** 新增媒体资产记录的入参 */
export interface MediaAssetInput {
  mediaType: MediaAsset["mediaType"];
  url: string;
  entityType: MediaAsset["entityType"];
  entityName?: string;
  prompt?: string;
  source: MediaAsset["source"];
  seriesId?: string;
  seriesTitle?: string;
  episodeId?: string;
  episodeTitle?: string;
}

/** Suno 歌手音色来源类型 */
export type VoicePersonaSourceType = "upload" | "tts" | "url";

/** Suno 歌手音色状态 */
export type VoicePersonaStatus = "idle" | "pending" | "completed" | "failed";

/** Suno 歌手音色（全局共享，不绑定企划） */
export interface VoicePersona {
  id: string;
  /** 用户自定义名称 */
  name: string;
  /** Suno 返回的 persona_id，用于音乐生成 */
  personaId: string;
  /** 创建方式 */
  sourceType: VoicePersonaSourceType;
  /** 创建音色所用的源音频 URL（可播放预览） */
  sourceAudioUrl: string;
  /** TTS 模式的音色描述 */
  description?: string;
  /** 创建状态 */
  status: VoicePersonaStatus;
  /** 失败原因 */
  error?: string;
  /** Suno 任务 ID（用于断点轮询恢复） */
  sunoTaskId?: string;
  createdAt: number;
  updatedAt: number;
}

/** 预设库资源类型 */
export type PresetType = "image" | "video" | "audio" | "text";

/** 预设库资源项（用户自管理，媒体类上传 / 文本类在线编辑） */
export interface PresetItem {
  id: string;
  name: string;
  type: PresetType;
  url: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/** 预设库标签（全局共享） */
export interface PresetTag {
  id: string;
  name: string;
  createdAt: number;
}

/** 预设库选择回传项（媒体含 url，文本含 content） */
export interface PickedPresetItem {
  id: string;
  name: string;
  url?: string;
  content?: string;
}
