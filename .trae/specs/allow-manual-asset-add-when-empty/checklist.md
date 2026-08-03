# Checklist

- [x] `AssetPreparation.tsx` 资产卡片区域不再以 `preparationAssets.length === 0` 作为是否渲染网格的分支条件，网格始终渲染
- [x] 空状态下不再渲染任何独立空状态占位提示（🖼️ 引导框已移除）
- [x] 空状态下「添加资产」占位卡片（含「新建资产 / 从设定选择」表单）可见且可交互
- [x] 空状态下「新建资产」模式：填写名称+类型确认后，新资产经 `onReplaceAssets` 追加
- [x] 空状态下「从设定选择」模式：选择设定确认后追加为资产；无设定时提示「暂无可选的…设定」且不阻断新建模式
- [x] 非空状态下资产卡片网格 + 末尾「添加资产」卡片行为与样式与改动前一致
- [x] 未新增/改动状态、handler 或数据结构，复用现有 `handleAddAsset` / `handleAddFromSettings` / `resetAddCard` / `availableSettings`
- [x] `npx tsc --noEmit` 通过，无类型错误
