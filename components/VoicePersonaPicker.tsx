"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getVoicePersonas } from "@/lib/storage";
import type { VoicePersona } from "@/lib/types";

const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60";

const SOURCE_LABELS: Record<VoicePersona["sourceType"], string> = {
  upload: "上传",
  tts: "TTS",
  url: "链接",
};

interface VoicePersonaPickerProps {
  value: string;
  disabled?: boolean;
  onChange: (personaId: string) => void;
  /** 当前企划 ID，用于按企划过滤可选音色 */
  seriesId?: string;
}

export default function VoicePersonaPicker({
  value,
  disabled,
  onChange,
  seriesId,
}: VoicePersonaPickerProps) {
  const [personas, setPersonas] = useState<VoicePersona[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getVoicePersonas(seriesId);
        if (!cancelled) {
          setPersonas(list.filter((p) => p.status === "completed" && p.personaId));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seriesId]);

  const selected = personas.find((p) => p.personaId === value);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-sm font-medium text-slate-700">歌手音色</label>
        <Link
          href="/assets"
          className="text-xs text-brand-600 hover:text-brand-700 hover:underline"
        >
          管理音色 →
        </Link>
      </div>
      <select
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT_CLASS}
      >
        <option value="">不使用音色（默认人声）</option>
        {personas.map((p) => (
          <option key={p.id} value={p.personaId}>
            {p.name}（{SOURCE_LABELS[p.sourceType]}）
          </option>
        ))}
      </select>
      {loading && (
        <p className="mt-1 text-xs text-slate-400">正在加载音色列表…</p>
      )}
      {!loading && personas.length === 0 && (
        <p className="mt-1 text-xs text-slate-400">
          暂无可用音色，请前往资产库创建
        </p>
      )}
      {selected && selected.sourceAudioUrl && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="mb-1 text-xs text-slate-500">
            试听「{selected.name}」的源音色
          </p>
          <audio
            controls
            src={selected.sourceAudioUrl}
            className="w-full"
            preload="metadata"
          />
        </div>
      )}
    </div>
  );
}
