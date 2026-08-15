# Checklist

- [x] `app/style-templates/page.tsx` 标题、副标题、说明条、列表标签、删除提示、占位符、hint、参考图徽标/状态、弹框标题均已改为提示词相关表述
- [x] `app/series/[id]/style-settings/page.tsx` 标题、选择标签、说明条及链接文字、空状态均已改为提示词设定/提示词管理表述
- [x] `app/page.tsx` 首页导航按钮显示「提示词管理」
- [x] `app/episode/[id]/page.tsx` 两个菜单项分别显示「提示词管理」「提示词设定」
- [x] `components/ImageGenerationDialog.tsx` 参考图开关与徽标显示「提示词参考」
- [x] `lib/style-settings.ts` 新建模板默认名为「新提示词」
- [x] 面向用户的 UI 文案中无残留「风格模板」「风格设定」「风格参考」「风格名称」「新风格」
- [x] 路由 `/style-templates`、`/series/[id]/style-settings` 未被改动
- [x] API 路径 `/api/settings/style-templates`、存储 key `style-templates` 未被改动
- [x] 类型名 `StylePreset`/`StyleSettings`、变量名 `styleTemplate`/`seriesStyleSettings` 等内部标识符未被改动
- [x] `styleToText`/`styleTemplateForType` 生成的 LLM 上下文文本未被改动
- [x] TypeScript 编译通过，无类型错误
