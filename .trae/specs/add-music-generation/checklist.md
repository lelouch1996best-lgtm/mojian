# Checklist

- [x] 设置页存在「音乐生成 API」区块（音频区块之后、COS 之前），可选 APIMart/自定义供应商、填 Base URL（默认 https://api.apimart.ai/v1）与 API Key，内置模型 suno，配置防抖落库且刷新后保留
- [x] `musics` 表随 getDb() 初始化创建；`GET /api/data/musics?seriesId=`、`POST /api/data/musics`、`DELETE /api/data/musics/[id]` 可用且带鉴权
- [x] 系列详情页内容区左上角有「剧集 / 音乐」切换，默认剧集面板行为不变
- [x] 音乐面板可「新建音乐」（跳转 /music/[id]）、卡片展示封面/标题/模式/状态/时长/播放器，删除有确认且不删资产库媒体记录
- [x] 音乐编辑页三种模式可切换且模式持久化到记录
- [x] 灵感模式：提示词必填、纯音乐开关、版本必选（默认 v5），提交上游 custom=false
- [x] 自定义模式：歌词（非纯音乐必填）/标题/风格/负面标签/人声性别/权重滑杆可控，提交上游 custom=true 且字段名正确（prompt/style/negative_tags/style_weight/weirdness_constraint/audio_weight）
- [x] 风格词库面板分类展示市面常见风格，点击追加到风格框（去重）、再点移除
- [x] 「AI 生成歌词」提交 lyrics 任务并回填歌词文本
- [x] 二次创作模式可从资产库选音乐（AssetPicker mediaType=music 单选）或粘贴公网 URL；本系列已生成音乐复用 sunoTaskId+audioIndex 直接 coverSong，否则先 uploadTask 导入再 coverSong；目标风格必填
- [x] 生成中展示状态并轮询（3–5s），失败展示上游 error.message，可修改参数重新生成
- [x] 完成后每个音轨转存 COS（ai-script/music），记录 tracks/status 更新，资产库各写一条 mediaType=music 记录（entityType/source 为 music，带系列信息）
- [x] 生成中刷新编辑页自动恢复轮询
- [x] 资产库「音乐」筛选胶囊可用，音乐卡片可直接播放；AssetPicker 支持 mediaType="music" 并以播放器渲染
- [x] 未配置音乐 API 时点击生成给出明确提示且不发起请求
- [x] `npm run lint` 与类型检查通过（项目无 lint 脚本，`npx tsc --noEmit` 通过）
