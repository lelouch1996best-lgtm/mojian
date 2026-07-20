# 音色系统 Spec

## Why
当前人物设定只支持视觉形象（图片），缺少声音维度。引入音色后，角色可拥有独立的声音样本，并在生成视频时自动把角色的音色资源拼接到提示词中，让视频模型据此生成带角色声音的内容。本期仅接入小米 MiMo 的 TTS 系列模型，音色文件统一存入腾讯云 COS。

## What Changes
- 在 API 设置中新增「音频生成 API」区块，接入 mimo 供应商及其三个 TTS 模型（`mimo-v2.5-tts` / `mimo-v2.5-tts-voicedesign` / `mimo-v2.5-tts-voiceclone`），支持模型列表管理。
- 在 `CharacterProfile` 上新增音色字段（`voiceUrl` 等），人物设定卡片支持「从资产库添加音色」与「生成音色」两种方式，生成的音频转存到 COS。
- 资产库新增「音色（audio）」媒体类型，人物设定的音色在此聚合展示与选取。
- 视频生成时，对提示词中 `@角色名` 命中且拥有音色的人物，自动在提示词末尾拼接 `@角色名的音色为：<音频资源URL>`。

## Impact
- 受影响类型/数据：[lib/types.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/types.ts)（`CharacterProfile`、`AssetLibraryItem`、新增 `AudioGenSettings` 等）
- 受影响模型预设：[lib/model-presets.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/model-presets.ts)（新增音频模型列表与能力）
- 新增客户端：`lib/audio-client.ts`（音频设置/生成）、`app/api/audio/route.ts`（mimo TTS 代理）
- 受影响人物设定：[lib/character-settings.ts](file:///Users/hehuajiu/Workbuddy/mojian/lib/character-settings.ts)、[app/series/[id]/characters/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/page.tsx)、[app/series/[id]/characters/CharacterCard.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/series/[id]/characters/CharacterCard.tsx)、新增 `components/VoiceGenerationDialog.tsx`
- 受影响资产库：[app/api/data/assets/route.ts](file:///Users/hehuajiu/Workbuddy/mojian/app/api/data/assets/route.ts)、[components/AssetLibrary.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetLibrary.tsx)、[components/AssetPicker.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/AssetPicker.tsx)
- 受影响视频生成：[components/VideoGeneration.tsx](file:///Users/hehuajiu/Workbuddy/mojian/components/VideoGeneration.tsx)、[app/episode/[id]/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/episode/[id]/page.tsx)
- 受影响设置页：[app/settings/page.tsx](file:///Users/hehuajiu/Workbuddy/mojian/app/settings/page.tsx)

## ADDED Requirements

### Requirement: 音频生成 API 供应商与模型管理
系统 SHALL 在设置页提供独立的「音频生成 API」配置区块，支持配置 mimo 供应商（Base URL、API Key）与模型列表，并支持自定义供应商。模型列表与图片/视频模型一致地持久化到服务端，可增删与恢复默认。

#### Scenario: 配置 mimo 音频 API
- **WHEN** 用户在设置页打开「音频生成 API」区块，选择 mimo 供应商并填写 API Key
- **THEN** 配置自动保存到服务端 `audio` 设置项，区块状态显示「已配置」

#### Scenario: 管理音频模型列表
- **WHEN** 用户点击「管理模型」并新增/删除模型
- **THEN** 变更按供应商持久化到 `models_audio` 设置项，并在音色生成弹框的模型下拉中生效

#### Scenario: 恢复默认音频模型
- **WHEN** 用户点击「初始化模型列表」
- **THEN** mimo 供应商的模型列表恢复为 `mimo-v2.5-tts`、`mimo-v2.5-tts-voicedesign`、`mimo-v2.5-tts-voiceclone` 三个内置模型

### Requirement: mimo TTS 代理接口
系统 SHALL 提供 `/api/audio` 代理接口，将前端构造的 mimo TTS 请求透传到 `${baseURL}/chat/completions`，使用 `api-key` 请求头携带密钥，并从上游响应中解析出音频数据（base64）返回给前端。

#### Scenario: 成功生成音频
- **WHEN** 前端携带 `{ apiKey, baseURL, payload }`（payload 含 model/messages/audio）请求 `/api/audio`
- **THEN** 后端以 `api-key` 头转发到 mimo，解析 `choices[0].message.audio.data` 返回 `{ audioBase64, format }`

#### Scenario: 上游错误透传
- **WHEN** mimo 返回非 2xx 或响应缺少音频数据
- **THEN** `/api/audio` 返回对应错误信息，前端展示错误且不写入音色

### Requirement: 人物音色字段与持久化
系统 SHALL 在 `CharacterProfile` 上新增可选音色字段：`voiceUrl`（COS 音频 URL）、`voicePrompt`（音色设计描述，用于复用/再生成）、`voiceModel`（所用模型）、`voiceId`（预置音色 ID 或复刻来源标记）。字段随系列人物设定一并持久化。

#### Scenario: 保存音色
- **WHEN** 用户为某人物版本生成或添加音色并确认
- **THEN** 该 `CharacterProfile` 的 `voiceUrl` 等字段被写入系列 `characterSettings` 并落盘

### Requirement: 生成人物音色
系统 SHALL 在人物设定卡片提供「生成音色」入口，弹框内根据所选模型能力收集参数并调用 mimo TTS 生成音频，再转存到 COS 后回填 `voiceUrl`。

#### Scenario: 用 voicedesign 生成音色
- **WHEN** 用户选择 `mimo-v2.5-tts-voicedesign`，填写音色描述（可由人物性别/年龄/性格预填）与样例文本，点击生成
- **THEN** 系统调用 mimo 生成 wav 音频，转存 COS，卡片回填音色并可预览播放

#### Scenario: 用 voiceclone 复刻音色
- **WHEN** 用户选择 `mimo-v2.5-tts-voiceclone`，提供音频样本（上传或从资产库选取）与样例文本，点击生成
- **THEN** 系统以音频样本作为 `audio.voice` 调用 mimo 复刻并生成音频，转存 COS 后回填

#### Scenario: 用预置音色生成
- **WHEN** 用户选择 `mimo-v2.5-tts`，选择预置音色 ID（如 Chloe）与样例文本，点击生成
- **THEN** 系统以该 voice ID 调用 mimo 生成音频，转存 COS 后回填

### Requirement: 从资产库添加音色
系统 SHALL 在人物设定卡片提供「从资产库添加」入口，复用 `AssetPicker` 以 `mediaType="audio"` 选取已有音频资产，将选中音频 URL 回填为该人物的 `voiceUrl`。

#### Scenario: 选择已有音频作为音色
- **WHEN** 用户点击「从资产库添加」并在弹框选中一条音频资产并确认
- **THEN** 该人物 `voiceUrl` 被设为所选音频 URL，无需再次调用生成接口

### Requirement: 资产库聚合音色媒体
系统 SHALL 将资产库 `AssetLibraryItem.mediaType` 扩展为 `image | video | audio`，并在 `/api/data/assets` 中把各系列人物设定的 `voiceUrl` 聚合为 `mediaType: "audio"` 的条目（`source: "profile-character"`、`entityType: "character"`）。

#### Scenario: 资产库展示音色
- **WHEN** 任意人物版本存在 `voiceUrl`
- **THEN** 资产库列表出现对应 audio 条目，按 `createdAt` 降序排列

#### Scenario: 资产库音色筛选与播放
- **WHEN** 用户在资产库切换到「音色」分类
- **THEN** 仅展示 audio 条目，每条提供音频试听播放器

### Requirement: 视频生成注入角色音色
系统 SHALL 在视频生成（提交 Seedance 任务）前，扫描镜头 `finalPrompt` 中的 `@角色名`，按名称（大小写不敏感）匹配该系列最新版本人物设定；对拥有 `voiceUrl` 的命中角色，在提示词末尾追加 `@角色名的音色为：<voiceUrl>`。

#### Scenario: 自动拼接音色资源
- **GIVEN** 镜头 finalPrompt 含 `@林坤`，且该系列人物「林坤」最新版本有 `voiceUrl`
- **WHEN** 用户点击生成视频
- **THEN** 实际发送给 Seedance 的提示词在原文后追加 `@林坤的音色为：<voiceUrl>`

#### Scenario: 无音色不拼接
- **GIVEN** finalPrompt 含 `@小明`，但「小明」无 `voiceUrl` 或不存在该人物
- **WHEN** 用户点击生成视频
- **THEN** 提示词不对 `@小明` 追加任何音色内容

## MODIFIED Requirements

### Requirement: 人物设定卡片
人物设定卡片 SHALL 在形象图之外新增「音色」区，展示当前音色试听（`<audio>` 播放器），并提供「生成音色」「从资产库添加」「移除音色」操作；音色状态与图片生成/上传同样支持 loading 态与错误提示。

### Requirement: 资产选择器
`AssetPicker` SHALL 支持 `mediaType="audio"`，在音频模式下以音频卡片（含试听播放器）展示，确认时返回 `{ url, name }`；标题与空态文案随媒体类型自适应。

### Requirement: 视频生成组件入参
`VideoGeneration` SHALL 新增 `characterSettings?: CharacterProfile[] | null` 入参（由剧集页传入该系列人物设定），用于在生成视频时解析 `@角色名` 对应的音色资源。
