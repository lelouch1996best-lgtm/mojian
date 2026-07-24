"use client";

interface StepperProps {
  currentStep: 1 | 2 | 3 | 4;
  onStepClick: (step: 1 | 2 | 3 | 4) => void;
  step1Done: boolean;
  step2Done: boolean;
  step3Done: boolean;
}

const STEPS: { id: 1 | 2 | 3 | 4; label: string }[] = [
  { id: 1, label: "内容扩写" },
  { id: 2, label: "分镜生成" },
  { id: 3, label: "资产准备" },
  { id: 4, label: "视频生成" },
];

export default function Stepper({
  currentStep,
  onStepClick,
  step1Done,
  step2Done,
  step3Done,
}: StepperProps) {
  return (
    <div className="flex flex-wrap items-center">
      {STEPS.map((s, i) => {
        const isActive = currentStep === s.id;
        const isDone =
          s.id === 1
            ? step1Done
            : s.id === 2
              ? step2Done
              : s.id === 3
                ? step3Done
                : false;
        return (
          <div key={s.id} className="flex items-center">
            <button
              onClick={() => onStepClick(s.id)}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                isActive
                  ? "bg-brand-600 text-white"
                  : isDone
                    ? "bg-brand-50 text-brand-700 hover:bg-brand-100"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  isActive
                    ? "bg-white/25"
                    : isDone
                      ? "bg-brand-500 text-white"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {isDone ? "✓" : s.id}
              </span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-2 h-px w-6 ${
                  isDone ? "bg-brand-300" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
