# 人物提取冲突处理：新增「覆盖最新版本」选项

## Summary

在人物提取流程中，当提取到已存在的人物时，当前仅提供「新建版本」和「跳过」两个选项（通过浏览器原生 `confirm()` 弹窗）。本次改为使用自定义 Modal，提供三个选项：**覆盖最新版本** / **新建版本** / **跳过**，并支持批量处理所有冲突人物。

## Current State Analysis

- **数据模型**：`CharacterProfile` 已有 `characterId` + `version` + `versionLabel` 版本体系（`lib/types.ts` L24-49）。
- **提取流程**：`ContentExpansion.tsx` 调用 LLM 提取人物 → 调用 `onCharactersExtracted(characters)` 回调。
- **冲突处理**：`app/episode/[id]/page.tsx` L122-176 的 `handleCharactersExtracted`，按 `name` 精确匹配检测冲突，使用 `confirm()` 弹窗，只有「新建版本」(确定) / 「跳过」(取消)。
- **返回值**：`{ added, total, skipped }`，`ContentExpansion.tsx` 据此显示提示。
- **UI 组件**：已有 `components/ui/Modal.tsx`（支持 title/children/footer）和 `components/ui/Button.tsx`（variant: primary/secondary/ghost/danger）。

## Proposed Changes

### 1. 新建 `components/CharacterConflictModal.tsx`

批量冲突处理 Modal 组件。

**Props:**
```typescript
interface CharacterConflictItem {
  incoming: CharacterProfile;      // 提取到的新数据
  existing: CharacterProfile[];    // 已有的所有版本（按 version 降序）
  action: "overwrite" | "newVersion" | "skip";  // 用户选择，默认 "overwrite"
}

interface CharacterConflictModalProps {
  open: boolean;
  conflicts: CharacterConflictItem[];
  onActionChange: (index: number, action: CharacterConflictItem["action"]) => void;
  onConfirm: () => void;
  onCancel: () => void;
}
```

**UI 布局:**
- 标题：「人物冲突处理」
- 说明文字：「以下 N 个人物已存在，请选择处理方式」
- 每个冲突人物一行：
  - 人物名称 + 现有版本数 + 最新版本标签（如 `v2`）
  - 三个 radio 按钮：`覆盖最新版本` / `新建版本` / `跳过`
- Footer：`取消`（secondary）+ `确认应用`（primary）

### 2. 修改 `app/episode/[id]/page.tsx`

**新增 state（组件内）:**
```typescript
const [conflictModalOpen, setConflictModalOpen] = useState(false);
const [conflictItems, setConflictItems] = useState<CharacterConflictItem[]>([]);
const conflictResolverRef = useRef<((items: CharacterConflictItem[]) => void) | null>(null);
```

**重构 `handleCharactersExtracted`（L122-176）:**

1. 按 `name` 分组已有人物（现有逻辑不变）。
2. 遍历提取到的人物，分离为：
   - **新人物**：直接加入 `merged`，`added++`。
   - **冲突人物**：收集到 `conflicts` 数组，每个默认 `action: "overwrite"`。
3. 若 `conflicts.length > 0`：
   - 通过 Promise + resolver ref 等待用户在 Modal 中选择。
   - `setConflictItems(conflicts)` + `setConflictModalOpen(true)`。
   - `await new Promise(resolve => { conflictResolverRef.current = resolve; })`。
4. 遍历用户确认后的 `conflicts`，按 `action` 处理：
   - **`overwrite`**: 找到该角色最新版本（version 最大），用 incoming 的内容字段（role/genderAge/appearance/personality/background/relationships）覆盖，保留 id/characterId/version/versionLabel/name/imageUrl。在 `merged` 中替换该条目。`overwritten++`。
   - **`newVersion`**: 现有逻辑 —— 继承 characterId，version = maxVersion + 1，versionLabel = `v{maxVersion+1}`，push 到 merged。`added++`。
   - **`skip`**: 跳过。`skipped++`。
5. 保存 series，返回 `{ added, overwritten, total, skipped }`。

**Modal 交互回调:**
```typescript
function handleConflictConfirm() {
  setConflictModalOpen(false);
  conflictResolverRef.current?.(conflictItems);
  conflictResolverRef.current = null;
}
function handleConflictCancel() {
  setConflictModalOpen(false);
  // 全部视为跳过
  conflictResolverRef.current?.(conflictItems.map(c => ({ ...c, action: "skip" })));
  conflictResolverRef.current = null;
}
```

**在 JSX return 中添加 Modal 渲染**（在 `</main>` 前）:
```tsx
<CharacterConflictModal
  open={conflictModalOpen}
  conflicts={conflictItems}
  onActionChange={(i, action) => setConflictItems(prev =>
    prev.map((c, idx) => idx === i ? { ...c, action } : c)
  )}
  onConfirm={handleConflictConfirm}
  onCancel={handleConflictCancel}
/>
```

**更新返回类型:**
```typescript
// 旧
Promise<{ added: number; total: number; skipped: number }>
// 新
Promise<{ added: number; overwritten: number; total: number; skipped: number }>
```

### 3. 修改 `components/ContentExpansion.tsx`

**更新 props 类型（L31）:**
```typescript
onCharactersExtracted?: (characters: CharacterProfile[]) => Promise<{ added: number; overwritten: number; total: number; skipped: number }>;
```

**更新提示文案（L162-169）:**
```typescript
const parts: string[] = [];
if (result.added > 0) parts.push(`新增 ${result.added} 个`);
if (result.overwritten > 0) parts.push(`覆盖 ${result.overwritten} 个`);
if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 个`);
```

## Assumptions & Decisions

1. **覆盖 = 仅更新最新版本的内容字段**，保留 id/characterId/version/versionLabel/imageUrl 不变。版本历史完整保留。
2. **冲突默认选中「覆盖最新版本」**，因为剧情发展中人物属性变化时，覆盖最新版是最常见操作。
3. **用户取消 Modal = 全部跳过**，安全默认。
4. **批量处理**：一次 Modal 展示所有冲突，用户统一选择后一次性应用。避免逐个弹窗。
5. **返回类型新增 `overwritten` 字段**，`added` 仍包含新人物 + 新建版本。
6. **不修改数据模型** —— `CharacterProfile` 接口已有全部所需字段。
7. **不实现版本关联功能**（用户确认暂不需要）。

## Verification

1. 提取人物时，若所有人物都是新的 → 无 Modal，直接添加，提示「新增 N 个」。
2. 提取到已存在人物 → 弹出 Modal，列出所有冲突人物，每人可选覆盖/新建版本/跳过。
3. 选「覆盖最新版本」→ 最新版本的 role/appearance/personality 等字段被更新，版本号和 characterId 不变。
4. 选「新建版本」→ 新增一条记录，version+1，继承 characterId。
5. 选「跳过」→ 该人物不处理。
6. 点击「取消」或关闭 Modal → 所有冲突视为跳过。
7. 提示文案正确显示「新增 X 个，覆盖 Y 个，跳过 Z 个」。
8. 人物管理页面 `/series/[id]/characters` 中可看到覆盖后的最新版本数据和保留的历史版本。
