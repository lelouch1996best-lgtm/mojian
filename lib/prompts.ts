import type { Asset, AssetType, LLMMessage, Shot } from "./types";
import { SHOT_TYPES, CAMERA_MOVES, CAMERA_MOVE_DESCRIPTIONS } from "./shot-options";
import { getSystemPromptSync, applyPlaceholders } from "./system-prompts";

/** 世界设定前缀模板 */
function worldContext(text: string): string {
  if (!text?.trim()) return "";
  return `\n\n【世界设定 -- 请严格遵循以下世界观和风格要求】\n${text.trim()}\n`;
}

/** 人物设定前缀模板 */
function characterContext(text: string): string {
  if (!text?.trim()) return "";
  return `\n\n【人物设定 -- 请保持以下人物的性格、外貌、关系一致性】\n${text.trim()}\n`;
}

/** 物品设定前缀模板 */
function objectContext(text: string): string {
  if (!text?.trim()) return "";
  return `\n\n【物品设定 -- 请保持以下物品的外观、功能、来源设定一致性】\n${text.trim()}\n`;
}

/** 场景设定前缀模板 */
function sceneContext(text: string): string {
  if (!text?.trim()) return "";
  return `\n\n【场景设定 -- 请保持以下场景的环境、氛围设定一致性】\n${text.trim()}\n`;
}

// (a) Step1 内容扩写
export function expansionMessages(
  content: string,
  worldText = "",
  characterText = "",
  objectText = "",
  sceneText = "",
  previousEpisodesContext = "",
): LLMMessage[] {
  const ctx = worldContext(worldText);
  const charCtx = characterContext(characterText);
  const objCtx = objectContext(objectText);
  const scnCtx = sceneContext(sceneText);
  const prevCtx = previousEpisodesContext
    ? `\n\n【前文剧情（前几集扩写内容，供参考以保持剧情连贯）】\n${previousEpisodesContext}\n`
    : "";
  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("expansion"), {
        "{worldContext}": ctx,
        "{characterContext}": charCtx,
        "{objectContext}": objCtx,
        "{sceneContext}": scnCtx,
        "{previousEpisodesContext}": prevCtx,
      }),
    },
    { role: "user", content: `请扩写以下内容：\n\n${content}` },
  ];
}

// (b) Step2 分镜生成（要求返回 JSON）
export function storyboardMessages(content: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("storyboard"), {
        "{shotTypes}": SHOT_TYPES.join("、"),
        "{cameraMoves}": CAMERA_MOVES.join("、"),
      }),
    },
    { role: "user", content: `请为以下剧本生成分镜：\n\n${content}` },
  ];
}

// (c) 单行最终提示词生成（输出中文提示词）
export function finalPromptMessages(
  shot: Pick<
    Shot,
    | "duration"
    | "visualDescription"
    | "shotType"
    | "lightingMood"
    | "dialogueVoiceover"
    | "soundEffects"
    | "cameraMovement"
  >
): LLMMessage[] {
  const fields = [
    shot.duration && `- 时长：${shot.duration}`,
    shot.visualDescription && `- 画面描述：${shot.visualDescription}`,
    shot.shotType && `- 景别：${shot.shotType}`,
    shot.lightingMood && `- 光影氛围：${shot.lightingMood}`,
    shot.dialogueVoiceover && `- 对白旁白：${shot.dialogueVoiceover}`,
    shot.soundEffects && `- 音效：${shot.soundEffects}`,
    shot.cameraMovement && `- 运镜：${shot.cameraMovement}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content: `你是一位 AI 视频生成提示词专家。根据提供的镜头信息，生成一段用于 AI 视频生成模型（如可灵、即梦、Sora）的中文提示词。

要求：
1. 生成一段详细、连贯的中文提示词，描述画面主体、镜头运动、光影效果、氛围与风格
2. 提示词应适合视频生成模型理解，语言精炼但信息完整
3. 如果某些字段为空，根据已有信息合理推断补充，不要留空
4. 只返回提示词本身，不要任何额外说明或前缀`,
    },
    { role: "user", content: `请根据以下镜头信息生成视频提示词：\n${fields}` },
  ];
}

// (d) Step2 智能标注：识别画面描述中的人物/场景/物品，用 @名称@ 包裹
// 输入：所有镜头的画面描述（带序号）；输出：JSON {"items":[{"index":0,"text":"..."}]}
export function taggingMessages(shots: Shot[]): LLMMessage[] {
  const list = shots
    .map((s, i) => `【镜头${i + 1}】${s.visualDescription}`)
    .join("\n");

  return [
    {
      role: "system",
      content: getSystemPromptSync("tagging"),
    },
    { role: "user", content: `请为以下镜头画面描述做实体标注：\n\n${list}` },
  ];
}

// (d2) Step2 单行智能标注：仅标注单个镜头，且必须保留已有 @标签，仅补充新标签
// 输入：单个镜头的画面描述（可能已含 @标签）、已有标签列表、全局已知标签列表
// 输出：JSON {"text":"标注后的画面描述"}
export function singleRowTaggingMessages(
  shot: Pick<Shot, "visualDescription">,
  existingTags: string[],
  knownTags: string[] = [],
): LLMMessage[] {
  const existingHint = existingTags.length
    ? `\n\n【已有标签 -- 必须原样保留，不得删除 @ 前缀、不得改名、不得移动位置】\n${existingTags.map((t) => `- @${t}`).join("\n")}`
    : "";
  const knownHint = knownTags.length
    ? `\n\n【全局已知标签 -- 命中同一实体时请复用相同名称，保持全文一致】\n${knownTags.join("、")}`
    : "";

  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("singleRowTagging"), {
        "{existingTagsHint}": existingHint,
        "{knownTagsHint}": knownHint,
      }),
    },
    {
      role: "user",
      content: `请为以下镜头画面描述做实体标注（保留已有 @标签，仅补充新标签）：\n\n${shot.visualDescription}`,
    },
  ];
}

// (e) Step3 资产准备：根据标签列表 + 扩写内容，分类并生成外观描述
// 输出：JSON {"assets":[{"name":"小明","type":"character","description":"..."}]}
export function assetMessages(
  tags: string[],
  expandedContent: string,
  styleText = "",
  characterText = ""
): LLMMessage[] {
  const tagList = tags.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const styleCtx = styleText
    ? `\n\n【风格设定 -- 生成描述时请遵循以下风格要求】\n${styleText}\n\n重要：生成 description 时，请确保描述内容与上述风格匹配。风格模板会在图片生成时自动拼接到描述末尾，因此你的 description 只需关注实体本身的具体外观描述即可。`
    : "";
  const charCtx = characterContext(characterText);

  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("asset"), {
        "{styleContext}": styleCtx,
        "{characterContext}": charCtx,
      }),
    },
    {
      role: "user",
      content: `剧本背景：
${expandedContent.slice(0, 1500)}

需要准备的实体标签：
${tagList}

请为以上每个实体生成资产信息。`,
    },
  ];
}

// (e2) Step3 重新生成单个资产的外貌/外观描述（流式）
export function regenerateAssetMessages(
  name: string,
  type: AssetType,
  expandedContent: string,
  styleText = ""
): LLMMessage[] {
  const typeLabel = type === "character" ? "人物" : type === "scene" ? "场景" : "物品";
  const fieldLabel = type === "character" ? "外貌" : "外观";
  const detailHint =
    type === "character"
      ? "面部特征、发型、体型、服饰、配饰等"
      : type === "object"
      ? "形状、材质、颜色、尺寸、细节等"
      : "环境布局、建筑/自然元素、光影氛围等";
  const styleCtx = styleText
    ? `\n\n【风格设定 -- 生成描述时请遵循以下风格要求】\n${styleText}`
    : "";

  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("regenerateAsset"), {
        "{typeLabel}": typeLabel,
        "{fieldLabel}": fieldLabel,
        "{detailHint}": detailHint,
        "{styleContext}": styleCtx,
      }),
    },
    {
      role: "user",
      content: `剧本背景：
${expandedContent.slice(0, 1500)}

${typeLabel}名称：${name}

请为该${typeLabel}生成${fieldLabel}描述。`,
    },
  ];
}

// (f) Step4 视频提示词生成：根据镜头信息 + 当前镜头关联资产，生成视频生成提示词
// 仅传入当前镜头关联到的资产，让 LLM 聚焦于本镜头画面进行描述
export function videoPromptMessages(
  shot: Pick<
    Shot,
    | "duration"
    | "visualDescription"
    | "shotType"
    | "lightingMood"
    | "dialogueVoiceover"
    | "soundEffects"
    | "cameraMovement"
  >,
  /** 本镜头关联的资产（由 @标签 / 子串匹配得出） */
  relatedAssets: Pick<Asset, "name" | "type" | "description">[],
): LLMMessage[] {
  const fields = [
    shot.duration && `- 时长：${shot.duration}`,
    shot.visualDescription && `- 画面描述：${shot.visualDescription}`,
    shot.shotType && `- 景别：${shot.shotType}`,
    shot.lightingMood && `- 光影氛围：${shot.lightingMood}`,
    shot.dialogueVoiceover && `- 对白旁白：${shot.dialogueVoiceover}`,
    shot.soundEffects && `- 音效：${shot.soundEffects}`,
    shot.cameraMovement && `- 运镜：${shot.cameraMovement}`,
  ]
    .filter(Boolean)
    .join("\n");

  const typeLabel = (a: Pick<Asset, "type">) =>
    a.type === "character" ? "人物" : a.type === "scene" ? "场景" : "物品";

  const formatRelated = (a: Pick<Asset, "name" | "type" | "description">) =>
    `- ${a.name}（${typeLabel(a)}）`;

  const relatedList = relatedAssets.map(formatRelated).join("\n");
  const relatedBlock = relatedAssets.length
    ? `【本镜头关联资产】（共 ${relatedAssets.length} 个，必须全部在提示词中以"@资产名称"出现）\n${relatedList}`
    : "【本镜头关联资产】\n（本镜头无关联资产）";

  const cameraMoveGuide = CAMERA_MOVES.map(
    (m) => `   - ${m} -> ${CAMERA_MOVE_DESCRIPTIONS[m]}`,
  ).join("\n");

  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("videoPrompt"), {
        "{cameraMoveGuide}": cameraMoveGuide,
      }),
    },
    {
      role: "user",
      content: `请根据以下镜头分镜信息和关联资产生成视频提示词：

【镜头分镜信息】
${fields}

${relatedBlock}`,
    },
  ];
}

// (h) Step4 故事板图片生成的画面描述提示词：由 LLM 根据镜头信息生成
export function storyboardImagePromptMessages(
  shot: Pick<
    Shot,
    | "duration"
    | "visualDescription"
    | "shotType"
    | "lightingMood"
    | "cameraMovement"
    | "dialogueVoiceover"
    | "soundEffects"
  >,
  relatedAssets: Pick<Asset, "name" | "type" | "description">[]
): LLMMessage[] {
  const typeLabel = (a: Pick<Asset, "type">) =>
    a.type === "character" ? "人物" : a.type === "scene" ? "场景" : "物品";

  const formatRelated = (a: Pick<Asset, "name" | "type" | "description">) =>
    `- ${a.name}（${typeLabel(a)}）：${a.description || "（无描述）"}`;

  const relatedList = relatedAssets.length
    ? relatedAssets.map(formatRelated).join("\n")
    : "（本镜头无关联资产）";

  const fields = [
    shot.duration && `- 时长：${shot.duration}`,
    shot.visualDescription && `- 画面描述：${shot.visualDescription}`,
    shot.shotType && `- 景别：${shot.shotType}`,
    shot.lightingMood && `- 光影氛围：${shot.lightingMood}`,
    shot.dialogueVoiceover && `- 对白旁白：${shot.dialogueVoiceover}`,
    shot.soundEffects && `- 音效：${shot.soundEffects}`,
    shot.cameraMovement && `- 运镜：${shot.cameraMovement}`,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    {
      role: "system",
      content: `你是一位影视分镜师。请根据提供的镜头信息和关联资产，生成一段用于 AI 图片生成的中文画面描述。
这段描述将被用来生成一张专业影视分镜故事板图片。

核心要求：
1. 描述要聚焦画面内容：主体动作、场景环境、镜头角度、光影氛围、关键道具与位置关系
2. 关联资产用"@资产名称"指代，例如"@林坤 躺在 @木屋 的木床上"
3. **严禁描述人物外貌、物品外观**（包括五官、发型、衣着、体型、材质、颜色、建筑外观等）--这些已由参考图提供，提示词中一律不要描写外貌，只需用"@资产名称"指代并描述其动作、位置关系与状态
4. 不要输出分镜格式要求（如网格、箭头、标注等），只输出纯粹的画面内容描述
5. 描述应详细但不过度渲染，适合作为图片生成模型的主体提示词
6. 只返回画面描述本身，不要任何额外说明或前缀`,
    },
    {
      role: "user",
      content: `请根据以下镜头信息和关联资产生成故事板画面描述：

【镜头信息】
${fields}

【本镜头关联资产】
${relatedList}

请直接输出画面描述。`,
    },
  ];
}

// (h-2) Step4 将镜头信息包装为完整的故事板图片生成提示词
// template：来自风格设定的故事板模板（可含 {镜头信息} 占位符）
// baseDescription：镜头信息主体（直接取自镜头字段，非 LLM 生成）
const STORYBOARD_PLACEHOLDER = "{镜头信息}";

export function wrapStoryboardTemplate(
  baseDescription: string,
  template: string,
): string {
  if (!template.trim()) return baseDescription;
  if (template.includes(STORYBOARD_PLACEHOLDER)) {
    return template.replace(STORYBOARD_PLACEHOLDER, baseDescription);
  }
  return `${template}\n${baseDescription}`;
}

/** 将当前镜头相关字段按清晰逻辑拼接为【当前镜头信息】信息块 */
export function buildShotInfoBlock(
  shot: Pick<
    Shot,
    | "duration"
    | "visualDescription"
    | "shotType"
    | "lightingMood"
    | "cameraMovement"
    | "dialogueVoiceover"
    | "soundEffects"
  >,
): string {
  const fields = [
    shot.visualDescription && `- 画面描述：${shot.visualDescription}`,
    shot.shotType && `- 景别：${shot.shotType}`,
    shot.lightingMood && `- 光影氛围：${shot.lightingMood}`,
    shot.cameraMovement && `- 运镜：${shot.cameraMovement}`,
    shot.duration && `- 时长：${shot.duration}`,
    shot.dialogueVoiceover && `- 对白旁白：${shot.dialogueVoiceover}`,
    shot.soundEffects && `- 音效：${shot.soundEffects}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (!fields) return "";
  return `【当前镜头组信息】\n${fields}`;
}

/**
 * 构建用于「生成图片」的镜头信息块（精简版）。
 * 仅保留对静态画面有视觉参考价值的字段：画面描述、景别、光影氛围；
 * 不含运镜（动态）、音效/对白旁白（声音）、时长（时间）等与静态图片无关的信息。
 */
export function buildShotInfoBlockForImage(
  shot: Pick<Shot, "visualDescription" | "shotType" | "lightingMood">,
): string {
  const fields = [
    shot.visualDescription && `- 画面描述：${shot.visualDescription}`,
    shot.shotType && `- 景别：${shot.shotType}`,
    shot.lightingMood && `- 光影氛围：${shot.lightingMood}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (!fields) return "";
  return `【当前镜头组信息】\n${fields}`;
}

// (i) 通用文本润色优化（AI 优化按钮使用），流式输出优化后的文本
export function optimizeTextMessages(
  content: string,
  context?: string,
): LLMMessage[] {
  const ctx = context?.trim()
    ? `\n\n【优化上下文 -- 请结合此背景进行润色】\n${context.trim()}\n`
    : "";
  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("optimizeText"), {
        "{context}": ctx,
      }),
    },
    { role: "user", content },
  ];
}

// (i1) 视频提示词专业优化（视频提示词右上角 AI 优化按钮专用），流式输出
// 将用户简短的分镜时间段描述扩写为结构化、模型可精准理解的专业视频提示词
export function optimizeVideoPromptMessages(content: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: getSystemPromptSync("optimizeVideo"),
    },
    { role: "user", content },
  ];
}

// (i2) 根据输入内容生成视频首帧画面的图片提示词（AI 动作下拉使用），流式输出
export function generateFirstFramePromptMessages(content: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: getSystemPromptSync("generateFirstFrame"),
    },
    { role: "user", content },
  ];
}

// (j) 智能添加单个镜头：根据简短内容描述，扩写并生成 1 个完整镜头（全部 7 字段）
// 输出：JSON {"shots":[{...}]}（调用方取首项）
export function smartShotMessages(content: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("smartShot"), {
        "{shotTypes}": SHOT_TYPES.join("、"),
        "{cameraMoves}": CAMERA_MOVES.join("、"),
      }),
    },
    { role: "user", content: `请根据以下内容生成一个分镜镜头：\n\n${content}` },
  ];
}

// (k) 根据用户提示词随机生成外貌/外观描述（流式）
export function generateAppearanceMessages(
  prompt: string,
  entityType: "character" | "object" | "scene",
): LLMMessage[] {
  const typeLabel = entityType === "character" ? "人物" : entityType === "scene" ? "场景" : "物品";
  const fieldLabel = entityType === "character" ? "外貌" : "外观";
  const detailHint =
    entityType === "character"
      ? "面部特征、发型、体型、服饰、配饰等"
      : entityType === "object"
      ? "形状、材质、颜色、尺寸、细节等"
      : "环境布局、建筑/自然元素、光影氛围等";

  return [
    {
      role: "system",
      content: applyPlaceholders(getSystemPromptSync("generateAppearance"), {
        "{typeLabel}": typeLabel,
        "{fieldLabel}": fieldLabel,
        "{detailHint}": detailHint,
      }),
    },
    {
      role: "user",
      content: `提示词：${prompt}\n\n请生成${typeLabel}${fieldLabel}描述。`,
    },
  ];
}

// (l) 从扩写内容中提取人物设定
// 输出：JSON {"characters":[{"name":"...","role":"...","genderAge":"...","appearance":"...","personality":"...","background":"...","relationships":"..."}]}
export function extractCharacterMessages(content: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: getSystemPromptSync("extractCharacter"),
    },
    {
      role: "user",
      content: `请从以下剧本内容中提取人物设定：\n\n${content}`,
    },
  ];
}
