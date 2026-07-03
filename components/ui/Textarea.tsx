"use client";

import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean;
}

export default function Textarea({
  autoGrow = true,
  className = "",
  value,
  onChange,
  ...rest
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    const el = ref.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, autoGrow]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none ${className}`}
      {...rest}
    />
  );
}
