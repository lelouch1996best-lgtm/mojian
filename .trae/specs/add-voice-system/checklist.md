# Checklist

## 音频 API 供应商与模型
- [x] 设置页存在独立的「音频生成 API」折叠区块，含 mimo 供应商选择、Base URL、API Key、模型管理
- [x] mimo 供应商默认模型列表包含 `mimo-v2.5-tts`、`mimo-v2.5-tts-voicedesign`、`mimo-v2.5-tts-voiceclone`
- [x] 音频 API Key/模型变更自动保存到服务端 `audio` / `models_audio` 设置项
- [x] `/api/audio` 代理以 `api-key` 头转发 mimo 请求，并从响应解析返回 `{ audioBase64, format }`

## 人物音色字段与生成
- [x] `CharacterProfile` 新增 `voiceUrl` / `voicePrompt` / `voiceModel` / `voiceId` 可选字段
- [x] 人物卡片「音色」段：无音色时显示「生成音色」「从资产库添加」
- [x] voicedesign 模型可由音色描述+样例文本生成音色并转存 COS
- [x] voiceclone 模型可由音频样本+样例文本复刻生成音色并转存 COS
- [x] 预置 tts 模型可由预置音色 ID+样例文本生成音色并转存 COS
- [x] 生成的音色在卡片可用 `<audio>` 试听，支持重新生成与移除
- [x] 音色字段随系列 `characterSettings` 一并持久化

## 从资产库添加音色
- [x] 「从资产库添加」打开 `AssetPicker`（mediaType="audio"），确认后回填 `voiceUrl` 且不再调用生成接口

## 资产库音色媒体
- [x] `AssetLibraryItem.mediaType` 支持 `"audio"`
- [x] `/api/data/assets` 把人物 `voiceUrl` 聚合为 audio 条目（source `profile-character`、entityType `character`）
- [x] 资产库「音色」分类仅展示 audio 条目，每条可试听播放
- [x] `AssetPicker` 音频模式标题/空态/卡片自适应

## 视频生成注入角色音色
- [x] `VideoGeneration` 新增 `characterSettings` 入参并由剧集页传入
- [x] 生成视频时扫描 finalPrompt 的 `@角色名`，匹配到有 `voiceUrl` 的人物则追加 `@角色名的音色为：<voiceUrl>`
- [x] 无音色/未命中的人物不追加任何内容
- [x] 同一角色仅追加一次（去重）

## 质量校验
- [x] lint 通过（项目未配置 ESLint，以 typecheck 为准）
- [x] typecheck 通过（`tsc --noEmit` 退出码 0）
