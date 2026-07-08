import type { Asset, LLMMessage, Shot } from "./types";

/** 世界设定前缀模板 */
function worldContext(text: string): string {
  if (!text?.trim()) return "";
  return `\n\n【世界设定 —— 请严格遵循以下世界观和风格要求】\n${text.trim()}\n`;
}

/** 人物设定前缀模板 */
function characterContext(text: string): string {
  if (!text?.trim()) return "";
  return `\n\n【人物设定 —— 请保持以下人物的性格、外貌、关系一致性】\n${text.trim()}\n`;
}

// (a) Step1 内容扩写
export function expansionMessages(
  content: string,
  worldText = "",
  characterText = "",
  previousEpisodesContext = "",
): LLMMessage[] {
  const ctx = worldContext(worldText);
  const charCtx = characterContext(characterText);
  const prevCtx = previousEpisodesContext
    ? `\n\n【前文剧情（前几集扩写内容，供参考以保持剧情连贯）】\n${previousEpisodesContext}\n`
    : "";
  return [
    {
      role: "system",
      content:
        `你是一位专业的视频剧本编剧助手。你的任务是对用户提供的粗略故事内容进行扩写和润色，使其更加丰富、生动、有画面感。保持原意，但补充细节、对话、场景描写和情感表达。直接输出扩写后的完整内容，不要添加任何额外说明、标题或前缀。${ctx}${charCtx}${prevCtx}`,
    },
    { role: "user", content: `请扩写以下内容：\n\n${content}` },
  ];
}

// (b) Step2 分镜生成（要求返回 JSON）
export function storyboardMessages(content: string, worldText = "", characterText = ""): LLMMessage[] {
  const ctx = worldContext(worldText);
  const charCtx = characterContext(characterText);
  return [
    {
      role: "system",
      content: `你是一位专业的视频分镜师。请将剧本内容拆分为多个镜头，生成分镜数据。${ctx}${charCtx}
要求：
1. 根据内容合理划分镜头，每个镜头应是一个完整的视觉单元
2. 为每个镜头填写全部字段
3. 景别从以下选择：特写、近景、中景、全景、远景
4. 运镜从以下选择：推、拉、摇、移、跟、固定
5. 必须返回一个合法的 JSON 对象，格式为 {"shots":[...]}，不要包含任何其他文字、不要使用 markdown 代码块

每个 shot 对象的字段：
- duration：时长，如 "3-5秒"
- visualDescription：画面描述
- shotType：景别
- lightingMood：光影氛围
- dialogueVoiceover：对白旁白
- soundEffects：音效
- cameraMovement：运镜

返回格式示例：
{"shots":[{"duration":"3-5秒","visualDescription":"...","shotType":"特写","lightingMood":"...","dialogueVoiceover":"...","soundEffects":"...","cameraMovement":"推"}]}`,
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
      content: `你是一位视频分镜分析师。你的任务是识别每个镜头画面描述中的关键实体，并用 @ 符号标注起来，供后续资产准备使用。

需要标注三类实体：
1. 人物：角色的名字或称呼（如 小明、老张、女孩、警察）
2. 场景：地点或环境（如 咖啡馆、街道、客厅、雨夜）
3. 物品：关键道具或物体（如 雨伞、咖啡杯、信件、手机）

标注规则：
- 用单个 @ 前缀标注实体，例如 "@小明 坐在 @咖啡馆 里，手里拿着 @咖啡杯"
- **每个 @标签 后面必须跟一个空格或中文/英文标点**（如：,。！？；：、"），确保标签不会和后面的文字粘连
- 同一实体在全文中用相同的名称标注，保持一致
- 只标注关键实体，不要标注形容词、动词、抽象概念等
- 保留原文结构，只做标注，不增删内容

【重要】标注粒度规则 —— 只标注独立资产的最外层，切勿标注子部件：
- 标了 @房子 就不要再标门窗、屋顶、烟囱、阳台（除非原文单独描述了门窗本身）
- 标了 @汽车 就不要再标轮胎、方向盘、车灯、座椅
- 标了 @书桌 就不要再标抽屉、笔筒
- 标了 @电脑 就不要再标键盘、鼠标、屏幕
- 标了 @街道 就不要再标路灯、垃圾桶、路牌
- 粒子：只标注画面描叙中**被独立描述的、有独立视觉存在感**的实体

【重要】数量控制 —— 每次标注总共不超过 10 个不同实体：
- 优先标注最重要的、在画面中反复出现或占有核心地位的人物和场景
- 如果实体数量超过 10 个，只保留最关键的 10 个，舍弃次要的

必须返回一个合法的 JSON 对象，格式为：
{"items":[{"index":0,"text":"标注后的画面描述"},{"index":1,"text":"..."}]}

其中 index 从 0 开始，对应输入镜头的顺序。不要包含任何其他文字、不要使用 markdown 代码块。`,
    },
    { role: "user", content: `请为以下镜头画面描述做实体标注：\n\n${list}` },
  ];
}

// (e) Step3 资产准备：根据标签列表 + 扩写内容，分类并生成图片提示词
// 输出：JSON {"assets":[{"name":"小明","type":"character","description":"...","imagePrompt":"..."}]}
export function assetMessages(
  tags: string[],
  expandedContent: string,
  styleText = "",
  characterText = ""
): LLMMessage[] {
  const tagList = tags.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const styleCtx = styleText
    ? `\n\n【漫剧风格 —— 生成图片提示词时请遵循以下风格要求】\n${styleText}\n\n重要：生成 imagePrompt 时，请确保提示词内容与上述风格匹配。风格模板会在图片生成时自动拼接到提示词末尾，因此你生成的 imagePrompt 只需关注实体本身的具体外观描述即可。`
    : "";
  const charCtx = characterContext(characterText);

  return [
    {
      role: "system",
      content: `你是一位 AI 视频制作的资产准备专家。根据提供的实体标签列表和剧本背景，为每个实体生成资产信息，用于后续生成参考图片。

对每个实体，你需要：
1. 判断类型（type）：character（人物）/ scene（场景）/ object（物品）
2. 生成描述（description）：结合剧本背景，用 1-2 句中文描述该实体的外观、特征、风格
3. 生成图片提示词（imagePrompt）：一段详细的中文提示词，用于 AI 图片生成模型（如可灵、即梦、Midjourney）生成该实体的参考图。提示词应包含：主体外观、服饰/材质、色彩、光影、构图等信息，适合图片生成模型理解

必须返回一个合法的 JSON 对象，格式为：
{"assets":[{"name":"小明","type":"character","description":"...","imagePrompt":"..."}]}

不要包含任何其他文字、不要使用 markdown 代码块。${styleCtx}${charCtx}`,
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

// (f) Step4 视频提示词生成：根据镜头信息 + 全部资产，生成视频生成提示词
// 把全部资产都传给 LLM，让它根据画面描述自行判断哪些资产出现在本镜头中
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
  /** 本镜头直接关联的资产（由 @标签 / 子串匹配得出） */
  relatedAssets: Pick<Asset, "name" | "type" | "description">[],
  /** 全部资产（兜底，确保 LLM 能引用到所有可能出现的实体） */
  allAssets: Pick<Asset, "name" | "type" | "description">[],
  /** 视频风格后缀（可选） */
  videoStyleSuffix = ""
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

  const formatAsset = (a: Pick<Asset, "name" | "type" | "description">) =>
    `- ${a.name}（${a.type === "character" ? "人物" : a.type === "scene" ? "场景" : "物品"}）：${a.description || "（无描述）"}`;

  const relatedList = relatedAssets.length
    ? relatedAssets.map(formatAsset).join("\n")
    : "（无直接匹配，请从全部资产中判断哪些出现在本镜头）";

  const allList = allAssets.length
    ? allAssets.map(formatAsset).join("\n")
    : "（无资产）";

  const styleNote = videoStyleSuffix
    ? `\n\n【视频风格要求】生成的提示词应遵循以下风格：${videoStyleSuffix}`
    : "";

  return [
    {
      role: "system",
      content: `你是一位 AI 视频生成提示词专家。根据提供的镜头信息和资产列表，生成一段用于 AI 视频生成模型（如可灵、即梦、Sora、Seedance）的中文提示词。

核心要求：
1. 仔细阅读画面描述，判断其中出现了哪些资产（人物、场景、物品）
2. **对于每个出现在画面中的资产，必须使用 @资产名称 的格式标注**，例如 "@小明 穿着 @红色长袍，站在 @古镇老街 上"。标注后紧接着写该资产的外观细节（服饰、材质、色彩、环境风格等），确保提示词中的资产与资产描述一致
3. 如果画面描述中出现了某个资产名称但不在"直接关联"列表中，请从"全部资产"列表中查找并引用
4. 生成的提示词应是一段详细、连贯的中文，描述画面主体、镜头运动、光影效果、氛围与风格
5. 如果镜头信息某些字段为空，根据已有信息合理推断补充，不要留空
6. 只返回提示词本身，不要任何额外说明或前缀${styleNote}`,
    },
    {
      role: "user",
      content: `请根据以下镜头信息和资产生成视频提示词：

【镜头信息】
${fields}

【直接关联资产（画面描述中 @标签 匹配到的）】
${relatedList}

【全部资产（如果画面描述中出现了这些资产的名称，也必须引用）】
${allList}`,
    },
  ];
}

// (g) Step1 人物设定提取：从扩写内容中提取人物档案
// 输出：JSON {"characters":[{"name":"...","role":"...","genderAge":"...","appearance":"...","personality":"...","background":"...","relationships":"..."}]}
export function extractCharacterMessages(expandedContent: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: `你是一位专业的剧本分析师。请从提供的剧本扩写内容中提取所有出现的人物，为每个人物生成详细的人物设定档案。

对每个人物，提取以下字段：
1. name：人物姓名或称呼（如剧本中只出现"女孩""老人"等泛称，也作为 name 使用）
2. role：角色定位（主角/配角/反派/路人等，根据出场重要程度判断）
3. genderAge：性别和年龄（如"男，25岁"；如剧本未明确，根据上下文合理推断）
4. appearance：外貌描述（外貌特征、穿着打扮；如剧本未明确描述，根据角色定位合理推断）
5. personality：性格特点（根据言行举止推断）
6. background：背景故事（根据剧本内容合理推断补充，不要凭空捏造与剧本矛盾的内容）
7. relationships：与其他人物的关系（如"A 的妻子""B 的上司"）

要求：
1. 只提取剧本中实际出现或有明确提及的人物，不要添加剧本中不存在的人物
2. 字段内容应基于剧本内容，可合理推断但不要与剧本矛盾
3. 如果剧本信息不足以填充某字段，填写"未明确"
4. 同一人物只输出一条记录

必须返回合法的 JSON 对象，格式为：
{"characters":[{"name":"...","role":"...","genderAge":"...","appearance":"...","personality":"...","background":"...","relationships":"..."}]}

不要包含任何其他文字、不要使用 markdown 代码块。`,
    },
    { role: "user", content: `请从以下剧本扩写内容中提取人物设定：\n\n${expandedContent}` },
  ];
}
