"use client";

import Modal from "./ui/Modal";
import Button from "./ui/Button";
import type { CharacterProfile } from "@/lib/types";

export type ConflictAction = "overwrite" | "newVersion" | "skip";

export interface CharacterConflictItem {
  /** 提取到的新数据 */
  incoming: CharacterProfile;
  /** 已有的所有版本（按 version 降序） */
  existing: CharacterProfile[];
  /** 用户选择的处理方式 */
  action: ConflictAction;
}

interface CharacterConflictModalProps {
  open: boolean;
  conflicts: CharacterConflictItem[];
  onActionChange: (index: number, action: ConflictAction) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const ACTION_LABELS: Record<ConflictAction, string> = {
  overwrite: "覆盖最新版本",
  newVersion: "新建版本",
  skip: "跳过",
};

export default function CharacterConflictModal({
  open,
  conflicts,
  onActionChange,
  onConfirm,
  onCancel,
}: CharacterConflictModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="人物冲突处理"
      width="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            确认应用
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-500">
        以下 {conflicts.length} 个人物已存在，请选择处理方式：
      </p>
      <div className="space-y-4">
        {conflicts.map((item, i) => {
          const latest = item.existing[0];
          const versionLabel = latest?.versionLabel || `v${latest?.version ?? 1}`;
          return (
            <div
              key={item.incoming.id}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="font-medium text-slate-800">
                  {item.incoming.name}
                </span>
                <span className="text-xs text-slate-400">
                  现有 {item.existing.length} 个版本
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  最新 {versionLabel}
                </span>
              </div>
              <div className="flex flex-wrap gap-4">
                {(Object.keys(ACTION_LABELS) as ConflictAction[]).map((act) => (
                  <label
                    key={act}
                    className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600"
                  >
                    <input
                      type="radio"
                      name={`conflict-${i}`}
                      checked={item.action === act}
                      onChange={() => onActionChange(i, act)}
                      className="text-brand-600 focus:ring-brand-500/30"
                    />
                    {ACTION_LABELS[act]}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
