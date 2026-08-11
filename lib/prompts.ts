import type { Asset, AssetType, LLMMessage, Shot } from "./types";
import { SHOT_TYPES, CAMERA_MOVES, CAMERA_MOVE_DESCRIPTIONS } from "./shot-options";

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
      content:
        `你是一位专业的视频剧本编剧助手。你的任务是对用户提供的粗略故事内容进行扩写和润色，使其更加丰富、生动、有画面感。保持原意，但补充细节、对话、场景描写和情感表达。直接输出扩写后的完整内容，不要添加任何额外说明、标题或前缀。${ctx}${charCtx}${objCtx}${scnCtx}${prevCtx}`,
    },
    { role: "user", content: `请扩写以下内容：\n\n${content}` },
  ];
}

// (b) Step2 分镜生成（要求返回 JSON）
export function storyboardMessages(content: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: `你是一位专业的视频分镜师。请将剧本内容拆分为多个镜头，生成分镜数据。
要求：
1. 根据内容合理划分镜头，每个镜头应是一个完整的视觉单元
2. 为每个镜头填写全部字段
3. 时长根据画面内容复杂度灵活设定：简单动作可用较短时长（如 3-5 秒），复杂连贯动作可用较长时长（如 10-20 秒），通常在 3-20 秒之间，填入 duration 字段，如 "8秒" 或 "10-15秒"
4. 景别从以下选择：${SHOT_TYPES.join("、")}
5. 运镜从以下选择：${CAMERA_MOVES.join("、")}
6. 必须返回一个合法的 JSON 对象，格式为 {"shots":[...]}，不要包含任何其他文字、不要使用 markdown 代码块

每个 shot 对象的字段：
- duration：时长，根据内容灵活设定（通常 3-20 秒），如 "8秒"
- visualDescription：画面描述（可串联多个连续子画面，按顺序描述）
- shotType：景别
- lightingMood：光影氛围
- dialogueVoiceover：对白旁白
- soundEffects：音效
- cameraMovement：运镜

返回格式示例：
{"shots":[{"duration":"8秒","visualDescription":"...","shotType":"特写","lightingMood":"...","dialogueVoiceover":"...","soundEffects":"...","cameraMovement":"推"}]}`,
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

【重要】标注粒度规则 -- 只标注独立资产的最外层，切勿标注子部件：
- 标了 @房子 就不要再标门窗、屋顶、烟囱、阳台（除非原文单独描述了门窗本身）
- 标了 @汽车 就不要再标轮胎、方向盘、车灯、座椅
- 标了 @书桌 就不要再标抽屉、笔筒
- 标了 @电脑 就不要再标键盘、鼠标、屏幕
- 标了 @街道 就不要再标路灯、垃圾桶、路牌
- 粒子：只标注画面描叙中**被独立描述的、有独立视觉存在感**的实体

【重要】数量控制 -- 每次标注总共不超过 10 个不同实体：
- 优先标注最重要的、在画面中反复出现或占有核心地位的人物和场景
- 如果实体数量超过 10 个，只保留最关键的 10 个，舍弃次要的

必须返回一个合法的 JSON 对象，格式为：
{"items":[{"index":0,"text":"标注后的画面描述"},{"index":1,"text":"..."}]}

其中 index 从 0 开始，对应输入镜头的顺序。不要包含任何其他文字、不要使用 markdown 代码块。`,
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
      content: `你是一位视频分镜分析师。你的任务是识别单个镜头画面描述中的关键实体，并用 @ 符号标注起来，供后续资产准备使用。

需要标注三类实体：
1. 人物：角色的名字或称呼（如 小明、老张、女孩、警察）
2. 场景：地点或环境（如 咖啡馆、街道、客厅、雨夜）
3. 物品：关键道具或物体（如 雨伞、咖啡杯、信件、手机）

标注规则：
- 用单个 @ 前缀标注实体，例如 "@小明 坐在 @咖啡馆 里，手里拿着 @咖啡杯"
- **每个 @标签 后面必须跟一个空格或中文/英文标点**（如：,。！？；：、"），确保标签不会和后面的文字粘连
- 同一实体用相同的名称标注，保持一致
- 只标注关键实体，不要标注形容词、动词、抽象概念等
- 保留原文结构，只做标注，不增删内容

【重要 -- 已有标签处理】
- 画面描述中可能已经包含 @标签，这些是已确认的标注，**必须原样保留**：不得删除其 @ 前缀、不得改名、不得移动位置
- 你只需识别**尚未被标注**的新实体并为其添加 @标签
- 若某实体与已有标签指代同一对象，复用已有标签名称，不要重复标注${existingHint}${knownHint}

【重要】标注粒度规则 -- 只标注独立资产的最外层，切勿标注子部件：
- 标了 @房子 就不要再标门窗、屋顶、烟囱、阳台（除非原文单独描述了门窗本身）
- 标了 @汽车 就不要再标轮胎、方向盘、车灯、座椅
- 标了 @书桌 就不要再标抽屉、笔筒
- 标了 @电脑 就不要再标键盘、鼠标、屏幕
- 标了 @街道 就不要再标路灯、垃圾桶、路牌
- 只标注画面描述中**被独立描述的、有独立视觉存在感**的实体

必须返回一个合法的 JSON 对象，格式为：
{"text":"标注后的画面描述"}

不要包含任何其他文字、不要使用 markdown 代码块。`,
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
      content: `你是一位 AI 视频制作的资产准备专家。根据提供的实体标签列表和剧本背景，为每个实体生成资产信息，用于后续生成参考图片。

对每个实体，你需要：
1. 判断类型（type）：character（人物）/ scene（场景）/ object（物品）
2. 生成描述（description）：结合剧本背景，用中文详细描述该实体的外观特征：
   - 人物（character）：外貌特征，包括面部、发型、体型、服饰、配饰等
   - 物品（object）：外观特征，包括形状、材质、颜色、尺寸、细节等
   - 场景（scene）：外观特征，包括环境布局、建筑/自然元素、光影氛围等
   该描述同时用于卡片展示和图片生成，应详细且具画面感
3. 只描述该实体静态的、固有的外观特征，不要描写实体当时的状态、姿态或动作（例如不要写"一只狗正在跑过来"这类动作描述）

必须返回一个合法的 JSON 对象，格式为：
{"assets":[{"name":"小明","type":"character","description":"..."}]}

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
      content: `你是一位 AI 视频制作的资产准备专家。请根据剧本背景，为指定的${typeLabel}生成${fieldLabel}描述。

要求：
1. 用中文详细描述该${typeLabel}的${fieldLabel}特征，包括${detailHint}
2. 描述应详细且具画面感，同时用于卡片展示和图片生成
3. 只描述该${typeLabel}静态的、固有的${fieldLabel}特征，不要描写该${typeLabel}当时的状态、姿态或动作（例如不要写"一只狗正在跑过来"这类动作描述）
4. 只返回${fieldLabel}描述文本本身，不要任何额外说明、前缀或 markdown 格式${styleCtx}`,
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
      content: `你是一位 Seedance 2.0 视频生成模型提示词专家。请根据提供的镜头分镜信息（分镜组）和关联资产，生成一段结构化、模型可精准理解的专业中文视频提示词。

【Seedance 2.0 提示词进阶公式 -- 请按此结构组织内容】
精准主体 + 动作细节 + 场景环境 + 光影色调 + 镜头运镜 + 视觉风格 + 画质 + 约束条件

【分镜信息专业转译规则 -- 务必将以下字段转译为模型可理解的镜头语言，不得原样照搬术语】

1. 景别（shotType）：作为镜头取景范围的开场定调，置于提示词前段。参考：
   - 大特写/特写 -> "特写镜头聚焦于……""大特写呈现……"
   - 近景/中景/中全景 -> "中景画面中……""近景展示……"
   - 全景/远景/大远景 -> "全景展现……""远景俯瞰……"

2. 运镜（cameraMovement）：模型对标准运镜词理解力强，请将简短运镜术语转译为带方向、速度、节奏的专业运镜描述。映射参考：
${cameraMoveGuide}
   重要：一个镜头只指定 1 种运镜方式，切勿同时要求推拉摇移，否则画面不稳定。

3. 光影氛围（lightingMood）：转译为具体的光影色调描述，涵盖光源方向、色温、明暗对比与质感。参考：
   - "暖黄日光从窗外斜射" "冷蓝月光勾勒人物轮廓" "逆光剪影，边缘高光" "柔光均匀漫射，无强烈阴影" "丁达尔光束穿透雾气"

【动作描述要求】
- 肢体细化 + 程度量化：动作具体到手、腿、头部、肩背等部位，补充幅度、速度、力度（如"缓慢抬手""微微低头""用力攥紧衣角"）
- 优先低缓连续的小动作，避免狂奔、大跳等高爆发大动态动作；写明前后动作的过渡衔接，保证连贯
- 情绪具象外化：用身体细节表现情绪，替代"很悲伤""非常愤怒"等抽象词

【核心约束】
1. 仅围绕当前镜头画面描述，不引入其他镜头或无关资产
2. 关联资产一律用"@资产名称"指代（如 @李华 缓步走向 @古镇老街），提供的资产必须全部在提示词中出现
3. **严禁描述人物/物品/场景的外貌形象**（包括五官、发型、衣着、体型、材质、颜色、建筑外观等）-- 外貌已由参考图提供，只用 @资产名称 指代并描述其动作、位置关系与状态
4. **必须包含对白旁白**：将"对白旁白"字段完整融入，用 {} 包裹对白原文并注明说话者（如 @李华 说道：{……}）；旁白同理用 {} 包裹；该字段为空时不要凭空编造对白
5. **必须包含音效描述**：Seedance 模型支持音视频联合生成，须根据"音效"字段描写本镜头声音元素（环境音、动作音、氛围音等），用 <> 标注（如 <雨滴敲打窗棂的细碎声><远处隐约的雷鸣>）；字段为空时根据画面情境合理推断补充，不可留空
6. 字段为空时根据已有信息合理推断补充，不留空；但"对白旁白"为空时不要凭空编造对白
7. 末尾追加画质与约束词：如"高清，电影质感，色彩自然，光影柔和，人物面部稳定不变形，动作连贯自然，保持无字幕，不要生成水印，不要生成Logo"
8. 只返回提示词本身，不要任何额外说明或前缀`,
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
      content: `你是一位专业的文字编辑。请润色优化以下文本，修正语法错误，优化表达流畅度和文采，使其更生动自然。保持原意不变，不要添加新的情节或信息。直接输出润色后的文本，不要任何额外说明或前缀。${ctx}`,
    },
    { role: "user", content },
  ];
}

// (i2) 根据输入内容生成视频首帧画面的图片提示词（AI 动作下拉使用），流式输出
export function generateFirstFramePromptMessages(content: string): LLMMessage[] {
  return [
    {
      role: "system",
      content: `你是一位专业的视频分镜与画面设计师。请根据用户提供的镜头信息或描述，生成一段用于生成「视频首帧图片」的画面提示词。

要求：
1. 从输入内容中提取画面描述、景别、光影氛围等静态视觉信息
2. 生成的提示词需强调静态画面要素：构图、人物姿态与位置、表情、场景布局、光影与氛围
3. 去除与静态图片无关的信息：运镜（推拉摇移等）、音效、对白旁白、时长等动态与声音信息
4. 输入内容中若包含 @标签（如 @韩立、@南宫婉），必须在结果中原样保留这些 @ 前缀，不得删除、改名或移动位置
5. 直接输出提示词文本，不要任何额外说明、前缀或 markdown 代码块`,
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
      content: `你是一位专业的视频分镜师。用户会提供一段简短的镜头内容描述，请据此扩写并生成一个完整的分镜镜头数据。

要求：
1. 将用户提供的简短内容扩写为详细、有画面感的画面描述，补充必要的动作、细节与情境
2. 如果用户输入的内容中包含 @标签（如 @韩立、@南宫婉），在画面描述（visualDescription）中必须保留这些 @ 前缀：原样使用相同的标签名称，不得删除 @ 前缀、不得改名、不得移动位置；扩写新增的内容中如再次提及同一实体，也一律使用 @标签
3. 为该镜头填写全部字段
4. 时长根据画面内容复杂度灵活设定：简单动作可用较短时长（如 3-5 秒），复杂连贯动作可用较长时长（如 10-20 秒），通常在 3-20 秒之间，填入 duration 字段，如 "8秒" 或 "10-15秒"
5. 景别从以下选择：${SHOT_TYPES.join("、")}
6. 运镜从以下选择：${CAMERA_MOVES.join("、")}
7. 只生成 1 个镜头
8. 必须返回一个合法的 JSON 对象，格式为 {"shots":[{...}]}，不要包含任何其他文字、不要使用 markdown 代码块

每个 shot 对象的字段：
- duration：时长，根据内容灵活设定（通常 3-20 秒），如 "8秒"
- visualDescription：画面描述（扩写后的详细描述，必须保留输入中的 @标签）
- shotType：景别
- lightingMood：光影氛围
- dialogueVoiceover：对白旁白
- soundEffects：音效
- cameraMovement：运镜

返回格式示例：
{"shots":[{"duration":"8秒","visualDescription":"...","shotType":"中景","lightingMood":"...","dialogueVoiceover":"...","soundEffects":"...","cameraMovement":"固定"}]}`,
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
      content: `你是一位 AI 视频制作的资产准备专家。请根据用户的提示词，生成一段详细的${typeLabel}${fieldLabel}描述。

要求：
1. 用中文详细描述该${typeLabel}的${fieldLabel}特征，包括${detailHint}
2. 描述应详细且具画面感，同时用于卡片展示和图片生成
3. 只描述该${typeLabel}静态的、固有的${fieldLabel}特征，不要描写该${typeLabel}当时的状态、姿态或动作（例如不要写"一只狗正在跑过来"这类动作描述）
4. 只返回${fieldLabel}描述文本本身，不要任何额外说明、前缀或 markdown 格式`,
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
      content: `你是一位专业的文学分析师。请从用户提供的剧本/故事内容中提取所有出场人物，并为每个人物生成设定信息。

需要提取的字段：
- name：人物名字或称呼（必填）
- role：人物在故事中的身份或角色定位
- genderAge：性别与年龄，如"青年男性"、"中年女性"
- appearance：外貌特征，包括面部、发型、体型、服饰、配饰等
- personality：性格特点
- background：背景信息或过往经历
- relationships：与其他人物的关系

要求：
1. 只提取在文中有实际出场或明确提及的人物
2. 若某些字段在文中没有明确信息，可根据上下文合理推断补充，但不得编造与原文明显矛盾的内容
3. 必须返回一个合法的 JSON 对象，格式为：
{"characters":[{"name":"...","role":"...","genderAge":"...","appearance":"...","personality":"...","background":"...","relationships":"..."}]}

不要包含任何其他文字、不要使用 markdown 代码块。`,
    },
    {
      role: "user",
      content: `请从以下剧本内容中提取人物设定：\n\n${content}`,
    },
  ];
}
