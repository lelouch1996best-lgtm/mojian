"use client";

import { useEffect, useState } from "react";
import Modal from "./ui/Modal";
import Button from "./ui/Button";
import type {
  CharacterProfile,
  ObjectProfile,
  SceneProfile,
  PreviousEpisodeContext,
} from "@/lib/types";

export interface ExpansionContextSelection {
  includeWorld: boolean;
  characterIds: string[];
  objectIds: string[];
  sceneIds: string[];
  episodeIds: string[];
}

interface ExpansionContextModalProps {
  open: boolean;
  /** 用于名称匹配的原文快照（打开弹窗时传入） */
  originalContent: string;
  /** 世界设定是否可用（有内容才显示该区块） */
  worldAvailable: boolean;
  characters: CharacterProfile[];
  objects: ObjectProfile[];
  scenes: SceneProfile[];
  previousEpisodes: PreviousEpisodeContext[];
  onConfirm: (selection: ExpansionContextSelection) => void;
  onClose: () => void;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function matchedIn(content: string, name: string): boolean {
  const n = name.trim();
  return !!n && content.includes(n);
}

export default function ExpansionContextModal({
  open,
  originalContent,
  worldAvailable,
  characters,
  objects,
  scenes,
  previousEpisodes,
  onConfirm,
  onClose,
}: ExpansionContextModalProps) {
  const [includeWorld, setIncludeWorld] = useState(false);
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [objectIds, setObjectIds] = useState<string[]>([]);
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const [episodeIds, setEpisodeIds] = useState<string[]>([]);

  // Modal 关闭时不卸载组件，需在每次打开时按默认规则重置勾选状态
  useEffect(() => {
    if (!open) return;
    setIncludeWorld(worldAvailable);
    setCharacterIds(
      characters.filter((c) => matchedIn(originalContent, c.name)).map((c) => c.id)
    );
    setObjectIds(
      objects.filter((o) => matchedIn(originalContent, o.name)).map((o) => o.id)
    );
    setSceneIds(
      scenes.filter((s) => matchedIn(originalContent, s.name)).map((s) => s.id)
    );
    setEpisodeIds([]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasSettingsSection =
    characters.length > 0 || objects.length > 0 || scenes.length > 0;

  const matchedBadge = (
    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-600">
      原文提及
    </span>
  );

  const checkboxClass = "text-brand-600 focus:ring-brand-500/30";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="AI 扩写上下文"
      width="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              onConfirm({ includeWorld, characterIds, objectIds, sceneIds, episodeIds })
            }
          >
            开始扩写
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-500">
        勾选本次扩写要携带的上下文，只有勾选的内容才会提供给 AI：
      </p>
      <div className="space-y-5">
        {worldAvailable && (
          <section>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">世界设定</h4>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={includeWorld}
                onChange={(e) => setIncludeWorld(e.target.checked)}
                className={checkboxClass}
              />
              世界设定
              <span className="text-xs text-slate-400">
                （故事背景 / 核心主题 / 写作风格）
              </span>
            </label>
          </section>
        )}

        {hasSettingsSection && (
          <section>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">关联设定</h4>
            <div className="space-y-3">
              {characters.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-400">人物</div>
                  <div className="space-y-1.5">
                    {characters.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"
                      >
                        <input
                          type="checkbox"
                          checked={characterIds.includes(c.id)}
                          onChange={() => setCharacterIds((ids) => toggleId(ids, c.id))}
                          className={checkboxClass}
                        />
                        <span className="text-slate-800">{c.name}</span>
                        {c.role?.trim() && (
                          <span className="text-xs text-slate-400">{c.role.trim()}</span>
                        )}
                        {matchedIn(originalContent, c.name) && matchedBadge}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {objects.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-400">物品</div>
                  <div className="space-y-1.5">
                    {objects.map((o) => (
                      <label
                        key={o.id}
                        className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"
                      >
                        <input
                          type="checkbox"
                          checked={objectIds.includes(o.id)}
                          onChange={() => setObjectIds((ids) => toggleId(ids, o.id))}
                          className={checkboxClass}
                        />
                        <span className="text-slate-800">{o.name}</span>
                        {o.category?.trim() && (
                          <span className="text-xs text-slate-400">{o.category.trim()}</span>
                        )}
                        {matchedIn(originalContent, o.name) && matchedBadge}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {scenes.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-400">场景</div>
                  <div className="space-y-1.5">
                    {scenes.map((s) => (
                      <label
                        key={s.id}
                        className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"
                      >
                        <input
                          type="checkbox"
                          checked={sceneIds.includes(s.id)}
                          onChange={() => setSceneIds((ids) => toggleId(ids, s.id))}
                          className={checkboxClass}
                        />
                        <span className="text-slate-800">{s.name}</span>
                        {s.category?.trim() && (
                          <span className="text-xs text-slate-400">{s.category.trim()}</span>
                        )}
                        {matchedIn(originalContent, s.name) && matchedBadge}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {previousEpisodes.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">前文剧集</h4>
            <div className="space-y-1.5">
              {previousEpisodes.map((ep) => (
                <label
                  key={ep.id}
                  className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"
                >
                  <input
                    type="checkbox"
                    checked={episodeIds.includes(ep.id)}
                    onChange={() => setEpisodeIds((ids) => toggleId(ids, ep.id))}
                    className={checkboxClass}
                  />
                  <span className="text-slate-800">
                    第 {ep.orderIndex} 集{ep.title.trim() ? ` · ${ep.title.trim()}` : ""}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              勾选的剧集将按约 3000 字上限带入，优先保留最近的剧集
            </p>
          </section>
        )}
      </div>
    </Modal>
  );
}
