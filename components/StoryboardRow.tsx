"use client";

import EditableCell, { type AtMentionOption } from "./EditableCell";
import OptionCombobox from "./OptionCombobox";
import Spinner from "./ui/Spinner";
import { removeTagPrefix } from "@/lib/utils";
import { SHOT_TYPES, CAMERA_MOVES } from "@/lib/shot-options";
import type { Shot } from "@/lib/types";

interface StoryboardRowProps {
  shot: Shot;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (field: keyof Shot, value: string) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  atMentionOptions?: AtMentionOption[];
  /** 智能标注当前行 */
  onTagRow?: () => void;
  /** 当前行是否正在标注 */
  rowTagging?: boolean;
  /** 禁用标注按钮（全局标注中或其它行标注中或无内容） */
  tagDisabled?: boolean;
}

const COMBO_INPUT_CLASS =
  "w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 hover:border-brand-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

export default function StoryboardRow({ shot, index, isFirst, isLast, onUpdate, onDelete, onMove, atMentionOptions, onTagRow, rowTagging, tagDisabled }: StoryboardRowProps) {
  return (
    <tr className="border-b border-slate-100 align-top hover:bg-slate-50/50">
      <td className="sticky left-0 z-10 w-12 bg-white px-2 py-2 text-center text-sm font-semibold text-slate-500">{index + 1}</td>
      <td className="px-1 py-2" style={{ minWidth: "80px" }}>
        <EditableCell value={shot.duration} onChange={(v) => onUpdate("duration", v)} placeholder="如 8秒" minWidth="70px" />
      </td>
      <td className="px-1 py-2" style={{ minWidth: "200px" }}>
        <EditableCell value={shot.visualDescription} onChange={(v) => onUpdate("visualDescription", v)} onRemoveTag={(tagName) => onUpdate("visualDescription", removeTagPrefix(shot.visualDescription, tagName))} placeholder="描述画面内容…" multiline minWidth="200px" renderTags atMentionOptions={atMentionOptions} allowCreateTag />
      </td>
      <td className="px-1 py-2" style={{ minWidth: "100px" }}>
        <OptionCombobox className={COMBO_INPUT_CLASS} value={shot.shotType} onChange={(v) => onUpdate("shotType", v)} options={SHOT_TYPES} placeholder="选择或输入…" />
      </td>
      <td className="px-1 py-2" style={{ minWidth: "130px" }}>
        <EditableCell value={shot.lightingMood} onChange={(v) => onUpdate("lightingMood", v)} placeholder="暖色调 / 逆光…" multiline minWidth="120px" />
      </td>
      <td className="px-1 py-2" style={{ minWidth: "150px" }}>
        <EditableCell value={shot.dialogueVoiceover} onChange={(v) => onUpdate("dialogueVoiceover", v)} placeholder="对白或旁白…" multiline minWidth="140px" />
      </td>
      <td className="px-1 py-2" style={{ minWidth: "120px" }}>
        <EditableCell value={shot.soundEffects} onChange={(v) => onUpdate("soundEffects", v)} placeholder="雨声 / 钢琴…" multiline minWidth="110px" />
      </td>
      <td className="px-1 py-2" style={{ minWidth: "100px" }}>
        <OptionCombobox className={COMBO_INPUT_CLASS} value={shot.cameraMovement} onChange={(v) => onUpdate("cameraMovement", v)} options={CAMERA_MOVES} placeholder="选择或输入…" />
      </td>
      <td className="sticky right-0 z-10 w-20 bg-white px-1 py-2">
        <div className="flex flex-col items-center gap-0.5">
          {onTagRow && (
            <button
              onClick={onTagRow}
              disabled={tagDisabled}
              className="text-slate-400 hover:text-amber-500 disabled:cursor-not-allowed disabled:opacity-30"
              title={rowTagging ? "标注中…" : "智能标注本行"}
            >
              {rowTagging ? (
                <Spinner size={14} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <circle cx="7" cy="7" r="1.5" fill="currentColor" />
                </svg>
              )}
            </button>
          )}
          <button onClick={() => onMove("up")} disabled={isFirst} className="text-slate-400 hover:text-brand-600 disabled:opacity-30" title="上移">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5l7 7H5l7-7z" fill="currentColor" /></svg>
          </button>
          <button onClick={() => onMove("down")} disabled={isLast} className="text-slate-400 hover:text-brand-600 disabled:opacity-30" title="下移">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 19l7-7H5l7 7z" fill="currentColor" /></svg>
          </button>
          <button onClick={onDelete} className="text-slate-400 hover:text-red-500" title="删除行">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </td>
    </tr>
  );
}
