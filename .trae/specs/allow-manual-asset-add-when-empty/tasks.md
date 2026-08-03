# Tasks

- [x] Task 1: 重构资产卡片区域，使「添加资产」卡片在空状态也渲染
  - [x] SubTask 1.1: 移除 `preparationAssets.length === 0 ? (空占位) : (网格)` 三元结构，改为始终渲染资产卡片网格 `<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">`，其中包含 `preparationAssets.map(...)` 与原有「添加资产」占位卡片（`!showAddCard ? ... : ...` 整块保持不变）
- [x] Task 1b: 移除空状态独立占位提示
  - [x] SubTask 1b.1: 删除 `{preparationAssets.length === 0 && ( ... 🖼️ 引导框 ... )}` 整块，空状态下不再显示任何独立占位元素，仅保留资产卡片网格（含「添加资产」卡片）
- [x] Task 2: 类型检查与验证
  - [x] SubTask 2.1: 运行 `npx tsc --noEmit` 确保无类型错误（exit 0，无输出）
  - [x] SubTask 2.2: 人工验证空状态下仅显示「添加资产」卡片，无独立空占位提示；新建/从设定选择均可添加资产
  - [x] SubTask 2.3: 人工验证非空状态行为不变：已有资产卡片 + 末尾「添加资产」卡片照常显示，添加/删除/生图流程未受影响

# Task Dependencies
- Task 1b 依赖 Task 1
- Task 2 依赖 Task 1b
