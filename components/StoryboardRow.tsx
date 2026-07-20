"use client";

import EditableCell from "./EditableCell";
import { removeTagPrefix } from "@/lib/utils";
import type { Shot } from "@/lib/types";

interface StoryboardRowProps {
  shot: Shot;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (field: keyof Shot, value: string) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}

const SHOT_TYPES = ["特写", "近景", "中景", "全景", "远景"];
const CAMERA_MOVES = ["推", "拉", "摇", "移", "跟", "固定"];

export default function StoryboardRow({
  shot,
  index,
  isFirst,
  isLast,
  onUpdate,
  onDelete,
  onMove,
}: StoryboardRowProps) {
  return (
    <tr className="border-b border-slate-100 align-top hover:bg-slate-50/50">
      {/* 进号 */}
      <td className="sticky left-0 z-10 w-12 bg-white px-2 py-2 text-center text-sm font-semibold text-slate-500">
        {index + 1}
      </td>

      {/* 时长 */}
      <td className="px-1 py-2" style={{ minWidth: "80px" }}>
        <EditableCell
          value={shot.duration}
          onChange={(v) => onUpdate("duration", v)}
          placeholder="10-15秒"
          minWidth="70px"
        />
      </td>

      {/* 画面描述 —— 显示态渲染 @标签 为蓝色 */}
      <td className="px-1 py-2" style={{ minWidth: "200px" }}>
        <EditableCell
          value={shot.visualDescription}
          onChange={(v) => onUpdate("visualDescription", v)}
          onRemoveTag={(tagName) =>
            onUpdate("visualDescription", removeTagPrefix(shot.visualDescription, tagName))
          }
          placeholder="描述画面内容…"
          multiline
          minWidth="200px"
          renderTags
        />
      </td>

      {/* 景别 */}
      <td className="px-1 py-2" style={{ minWidth: "90px" }}>
        <select
          value={shot.shotType}
          onChange={(e) => onUpdate("shotType", e.target.value)}
          className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 hover:border-brand-300 focus:border-brand-400 focus:outline-none"
        >
          <option value="">选择…</option>
          {SHOT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>

      {/* 光影氛围 */}
      <td className="px-1 py-2" style={{ minWidth: "130px" }}>
        <EditableCell
          value={shot.lightingMood}
          onChange={(v) => onUpdate("lightingMood", v)}
          placeholder="暖色调 / 逆光…"
          multiline
          minWidth="120px"
        />
      </td>

      {/* 对白旁白 */}
      <td className="px-1 py-2" style={{ minWidth: "150px" }}>
        <EditableCell
          value={shot.dialogueVoiceover}
          onChange={(v) => onUpdate("dialogueVoiceover", v)}
          placeholder="对白或旁白…"
          multiline
          minWidth="140px"
        />
      </td>

      {/* 音效 */}
      <td className="px-1 py-2" style={{ minWidth: "120px" }}>
        <EditableCell
          value={shot.soundEffects}
          onChange={(v) => onUpdate("soundEffects", v)}
          placeholder="雨声 / 钢琴…"
          multiline
          minWidth="110px"
        />
      </td>

      {/* 运镜 */}
      <td className="px-1 py-2" style={{ minWidth: "90px" }}>
        <select
          value={shot.cameraMovement}
          onChange={(e) => onUpdate("cameraMovement", e.target.value)}
          className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 hover:border-brand-300 focus:border-brand-400 focus:outline-none"
        >
          <option value="">选择…</option>
          {CAMERA_MOVES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>

      {/* 操作 */}
      <td className="sticky right-0 z-10 w-20 bg-white px-1 py-2">
        <div className="flex flex-col items-center gap-0.5">
          <button
            onClick={() => onMove("up")}
            disabled={isFirst}
            className="text-slate-400 hover:text-brand-600 disabled:opacity-30"
            title="上移"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 5l7 7H5l7-7z" fill="currentColor" />
            </svg>
          </button>
          <button
            onClick={() => onMove("down")}
            disabled={isLast}
            className="text-slate-400 hover:text-brand-600 disabled:opacity-30"
            title="下移"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 19l7-7H5l7 7z" fill="currentColor" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="text-slate-400 hover:text-red-500"
            title="删除行"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}
