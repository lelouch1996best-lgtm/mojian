# Tasks

- [x] Task 1: 类型与模型预设扩展
  - [x] SubTask 1.1: 在 [lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts) 新增 `AudioGenSettings`（provider: "mimo" | "custom"、baseURL、apiKey）、`AudioModelCapability`（supportsPresetVoice/supportsVoiceDesign/supportsVoiceClone/supportsSinging）；为 `CharacterProfile` 新增可选字段 `voiceUrl?`、`voicePrompt?`、`voiceModel?`、`voiceId?`；将 `AssetLibraryItem.mediaType` 扩展为 `"image" | "video" | "audio"`
  - [x] SubTask 1.2: 在 [lib/model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts) 新增 `DEFAULT_AUDIO_MODELS`（mimo 三个 TTS 模型，内嵌能力）、`AUDIO_MODEL_CAPABILITIES` 注册表、`FALLBACK_AUDIO_CAPABILITY`、`getAudioModelCapability`，以及 `getAudioModels`/`saveAudioModels`/`resetAudioModels`/`getAudioModelValues`（参照 video 模式，setting key `models_audio`），并在 `initAllModels` 中覆盖 `models_audio`

- [x] Task 2: 音频客户端与代理接口
  - [x] SubTask 2.1: 新建 `lib/audio-client.ts`，参照 [lib/video-client.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/video-client.ts) 实现 `AUDIO_PROVIDER_PRESETS`（mimo: baseURL `https://api.xiaomimimo.com/v1`、label「小米 MiMo」、keyPrefix 提示）、`DEFAULT_AUDIO_SETTINGS`、`getAudioSettings`/`saveAudioSettings`/`isAudioConfigured`/`getAudioProviderKeys`/`saveAudioProviderKey`
  - [x] SubTask 2.2: 在 `lib/audio-client.ts` 实现 `generateVoice(params)`：根据模型能力构造 mimo payload（messages：user 放风格/设计描述或空、assistant 放样例文本；`audio.format="wav"`，voicedesign 设 `optimize_text_preview`，voiceclone 设 `audio.voice=data:...;base64,...`，预置 tts 设 `audio.voice=voiceId`），调用 `/api/audio`，拿到 `audioBase64` 后通过 `/api/cos/upload` 转存 COS，返回 `{ voiceUrl, voicePrompt, voiceModel, voiceId }`
  - [x] SubTask 2.3: 新建 `app/api/audio/route.ts`，POST 接收 `{ apiKey, baseURL, payload }`，以 `api-key` 头转发到 `${baseURL}/chat/completions`，解析 `choices[0].message.audio.data` 返回 `{ audioBase64, format }`，错误透传

- [x] Task 3: 设置页音频 API 区块
  - [x] SubTask 3.1: 在 [app/settings/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx) 新增「音频生成 API」折叠区块，复用现有 provider 切换/缓存/BaseURL/APIKey/模型管理（`ModelManagerPanel`）模式，接入 `audio-client` 与 `getAudioModels` 等；自动保存与「初始化模型列表」覆盖 `models_audio`

- [x] Task 4: 人物设定音色 UI
  - [x] SubTask 4.1: 新建 `components/VoiceGenerationDialog.tsx`，参照 [components/ImageGenerationDialog.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/ImageGenerationDialog.tsx) 实现模型下拉 + 按能力渲染参数（voicedesign: 音色描述+样例文本；voiceclone: 音频样本上传/资产库选取+样例文本；预置 tts: 预置音色选择+样例文本），生成后预览播放
  - [x] SubTask 4.2: 在 [app/series/[id]/characters/CharacterCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/CharacterCard.tsx) 卡片内容区新增「音色」段：无音色时显示「生成音色」「从资产库添加」按钮；有音色时显示 `<audio>` 试听 + 重新生成 + 移除；支持 loading/错误态
  - [x] SubTask 4.3: 在 [app/series/[id]/characters/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx) 接入音色生成/添加/移除处理：生成走 `VoiceGenerationDialog`->`generateVoice`->回填 `voiceUrl` 等字段并保存系列；「从资产库添加」复用 `AssetPicker`（mediaType="audio"）；移除清空音色字段

- [x] Task 5: 资产库音色媒体
  - [x] SubTask 5.1: 在 [app/api/data/assets/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/assets/route.ts) 的人物设定循环中，为每个有 `voiceUrl` 的人物聚合 `mediaType:"audio"` 条目（id `profile-character-voice-{c.id}`、source `profile-character`、entityType `character`、entityName 取人物名）
  - [x] SubTask 5.2: 在 [components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx) 新增「音色」媒体分类与筛选 Tab，audio 条目用 `<audio controls>` 卡片展示，标题/空态自适应
  - [x] SubTask 5.3: 在 [components/AssetPicker.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPicker.tsx) 支持 `mediaType="audio"`：标题、空态文案、卡片渲染为音频试听，确认回传 `{ url, name }`

- [x] Task 6: 视频生成注入角色音色
  - [x] SubTask 6.1: 在 [components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx) 的 `VideoGenerationProps` 新增 `characterSettings?: CharacterProfile[] | null`，并在 `generateVideo` 构造 `finalVideoPrompt` 后、调用 `createVideoTask` 前，用 `extractTags(prompt)` 提取 `@角色名`，按名称匹配 `getLatestVersions(characterSettings)` 中有 `voiceUrl` 的人物，去重追加 `\n@角色名的音色为：<voiceUrl>`
  - [x] SubTask 6.2: 在 [app/episode/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx) 渲染 `<VideoGeneration>` 处补传 `characterSettings={seriesCharacterSettings}`

- [x] Task 7: 校验
  - [x] SubTask 7.1: 运行 lint/typecheck，修复类型与引用错误
  - [x] SubTask 7.2: 手动核对设置页音频区块、人物音色生成/添加/移除、资产库音色展示与选取、视频生成音色拼接四条主链路

# Task Dependencies
- Task 2 依赖 Task 1（类型与模型预设）
- Task 3 依赖 Task 1 与 Task 2
- Task 4 依赖 Task 1、Task 2、Task 5（资产库选取 audio）
- Task 5 依赖 Task 1（mediaType 扩展）
- Task 6 依赖 Task 1（voiceUrl 字段）
- Task 7 依赖 Task 1 ~ Task 6
