# Tasks

- [x] Task 1: 音乐数据层与类型定义
  - [x] SubTask 1.1: `lib/types.ts` 新增 `MusicGenSettings`（provider: "apimart" | "custom"，apiKey/baseURL/model）、`MusicMode`/`MusicStatus`/`MusicVersion`、`MusicParams`、`MusicSource`、`MusicTrack`（音轨）、`Music`（记录）、`MusicCreateProxyRequest/Response`、`MusicQueryProxyRequest/Response`；`MediaAsset.mediaType`/`entityType`/`source` 与 `AssetLibraryItem.mediaType` union 新增 `"music"`
  - [x] SubTask 1.2: `lib/db.ts` 的 `getDb()` 初始化中新增 `musics` 表（含 series_id 外键 ON DELETE CASCADE 与 created_at/series_id 索引）
  - [x] SubTask 1.3: 新增 `app/api/data/musics/route.ts`（GET ?seriesId= 升序、POST upsert，含 validateAuth 与 JSON 字段序列化）与 `app/api/data/musics/[id]/route.ts`（DELETE），模式参照 episodes 路由
  - [x] SubTask 1.4: `lib/api-client.ts` 新增 listMusics/saveMusic/deleteMusic 方法；`lib/storage.ts` 新增 getMusicsBySeries/saveMusic/deleteMusic 包装与 `emptyMusic(seriesId)`（参照 lib/utils.ts 的 emptyEpisode）
  - [x] SubTask 1.5: `app/api/data/media-assets/route.ts` 的 mediaType/entityType/source 白名单新增 `"music"`

- [x] Task 2: 音乐 API 设置区块
  - [x] SubTask 2.1: `lib/music-client.ts`（新）实现 `MUSIC_PROVIDER_PRESETS`（apimart: label APIMart, baseURL https://api.apimart.ai/v1；custom）、`DEFAULT_MUSIC_SETTINGS`、`get/saveMusicSettings`、`isMusicConfigured`、`get/save/clearMusicProviderKey`（settings key：`music` / `music_provider_keys`），模式仿 audio-client.ts 设置部分
  - [x] SubTask 2.2: `lib/model-presets.ts` 新增 `DEFAULT_MUSIC_MODELS`（apimart → [{ value: "suno", label: "Suno", isDefault: true }]，custom → []）与 `get/save/refreshBuiltInMusicModels`、`getMusicModelValues`（settings key：`models_music`）
  - [x] SubTask 2.3: `app/settings/page.tsx` 新增「音乐生成 API」fieldset（位于音频区块之后、COS 之前）：供应商按钮组、Base URL、API Key、模型管理（ModelManagerPanel 扩展 modelType "music"，无能力编辑器）、初始化默认配置按钮；state/handlers/防抖落库模式仿音频区块

- [x] Task 3: 音乐生成代理与客户端
  - [x] SubTask 3.1: `app/api/music/create/route.ts`（新）：按 action（generate/cover/upload/lyrics）映射上游端点（/music/generations、/coverSong、/uploadTask、/lyrics），Bearer 透传，返回 { taskId }，错误处理仿 app/api/video/create/route.ts 的 apimart 分支
  - [x] SubTask 3.2: `app/api/music/query/route.ts`（新）：转发 GET {base}/music/tasks/{taskId}，归一化 status/progress/music[]/lyrics/error
  - [x] SubTask 3.3: `lib/music-client.ts` 增补生成函数：`createMusicTask(action, payload)`、`queryMusicTask(taskId)`、`pollMusicTask(taskId, callbacks)`（4s 间隔、10 分钟超时）、`generateLyrics(theme)`（lyrics 任务提交+轮询+文本提取）

- [x] Task 4: 系列页音乐面板
  - [x] SubTask 4.1: `components/MusicList.tsx`（新）：仿 EpisodeList 的卡片网格 + 虚线「新建音乐」卡片；音乐卡片含封面/音符占位、标题、模式徽标、状态徽标、时长、首轨 <audio controls>、进入编辑按钮、删除按钮
  - [x] SubTask 4.2: `app/series/[id]/page.tsx` 新增「剧集 / 音乐」分段切换（内容区左上角，默认剧集）；音乐 tab 渲染 MusicList，实现 handleNewMusic（校验 isMusicConfigured → 创建记录 → 跳转 /music/[id]）与 handleDeleteMusic（confirm 后删除）

- [x] Task 5: 音乐编辑页
  - [x] SubTask 5.1: `lib/music-styles.ts`（新）：分类音乐风格词库（约 20 个分类、每类若干英文标签，覆盖市面常见风格）
  - [x] SubTask 5.2: `app/music/[id]/page.tsx`（新）页面骨架：返回/标题编辑、模式切换（灵感/自定义/二创，切模式持久化到记录）、版本选择、生成按钮、生成中/失败状态展示、音轨结果区（封面/标题/时长/播放器/歌词展开）
  - [x] SubTask 5.3: 灵感模式表单（提示词必填 + 纯音乐开关 + 版本）与自定义模式表单（歌词/标题/风格标签/负面标签/纯音乐/人声性别/权重滑杆），风格词库快速点选面板（点击追加/再点移除、去重）
  - [x] SubTask 5.4: 「AI 生成歌词」按钮：主题输入 → generateLyrics → 回填歌词框（生成中禁用）
  - [x] SubTask 5.5: 二次创作模式：AssetPicker（mediaType="music" 单选）/公网 URL 输入选择源；生成时按 spec 源解析规则（sunoTaskId 复用或 upload 导入）提交 coverSong（目标风格必填）
  - [x] SubTask 5.6: 生成流程编排：校验（apiKey/必填项）→ createMusicTask → 记录 status=pending + sunoTaskId → pollMusicTask → 完成后 transferAsset 转存音频与封面（prefix ai-script/music）→ 更新记录 tracks/status → 每轨 recordMediaAsset（mediaType/entityType/source 均 "music"）；失败写 error；页面加载时 status=pending 自动恢复轮询

- [x] Task 6: 资产库与选择器支持音乐类型
  - [x] SubTask 6.1: `components/AssetLibrary.tsx`：MediaTypeFilter 新增 "music"（胶囊「音乐」），过滤逻辑与卡片渲染（音频播放器 + 角标「音乐」）
  - [x] SubTask 6.2: `components/AssetPicker.tsx`：mediaType prop union 新增 "music"，加载过滤与音频播放器渲染兼容 music 类型

- [x] Task 7: 验证
  - [x] SubTask 7.1: 运行 `npm run lint` 与 `npx tsc --noEmit`（或项目既有检查命令），修复全部问题
  - [x] SubTask 7.2: 按 checklist.md 逐项验证并勾选

# Task Dependencies

- Task 2、Task 3 依赖 Task 1（类型定义），二者之间可并行
- Task 4 依赖 Task 1
- Task 5 依赖 Task 1、Task 3、Task 6（AssetPicker 支持 music）
- Task 6 依赖 Task 1
- Task 7 依赖 Task 1–6
