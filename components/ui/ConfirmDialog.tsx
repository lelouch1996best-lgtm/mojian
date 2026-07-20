"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import Modal from "./Modal";
import Button from "./Button";

type ConfirmVariant = "danger" | "primary";

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

type ShowErrorFn = (message: ReactNode, title?: string) => void;

const ErrorContext = createContext<ShowErrorFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm 必须在 <ConfirmProvider> 内使用");
  return fn;
}

export function useErrorDialog(): ShowErrorFn {
  const fn = useContext(ErrorContext);
  if (!fn) throw new Error("useErrorDialog 必须在 <ConfirmProvider> 内使用");
  return fn;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ErrorState {
  title: string;
  message: ReactNode;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setPending((cur) => {
      cur?.resolve(result);
      return null;
    });
  }, []);

  const showError = useCallback<ShowErrorFn>((message, title) => {
    setErrorState({ title: title ?? "出错了", message });
  }, []);

  const variant: ConfirmVariant = pending?.variant ?? "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      <ErrorContext.Provider value={showError}>
        {children}
        <Modal
          open={!!pending}
          onClose={() => settle(false)}
          title={pending?.title ?? "确认操作"}
          width="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => settle(false)}>
                {pending?.cancelText ?? "取消"}
              </Button>
              <Button
                variant={variant === "danger" ? "danger" : "primary"}
                onClick={() => settle(true)}
              >
                {pending?.confirmText ?? "确定"}
              </Button>
            </>
          }
        >
          <div className="flex gap-3">
            <span
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                variant === "danger"
                  ? "bg-red-50 text-red-600"
                  : "bg-brand-100 text-brand-500"
              }`}
            >
              {variant === "danger" ? <WarningIcon /> : <InfoIcon />}
            </span>
            <div className="pt-1 text-sm leading-relaxed text-slate-600 whitespace-pre-line">
              {pending?.message}
            </div>
          </div>
        </Modal>
        <Modal
          open={!!errorState}
          onClose={() => setErrorState(null)}
          title={errorState?.title ?? "出错了"}
          width="max-w-md"
          footer={
            <Button variant="danger" onClick={() => setErrorState(null)}>
              知道了
            </Button>
          }
        >
          <div className="flex gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <WarningIcon />
            </span>
            <div className="pt-1 text-sm leading-relaxed text-slate-600 whitespace-pre-line">
              {errorState?.message}
            </div>
          </div>
        </Modal>
      </ErrorContext.Provider>
    </ConfirmContext.Provider>
  );
}

function WarningIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 11v5m0-8h.01"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
