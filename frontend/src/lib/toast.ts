import { useSyncExternalStore } from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  type: ToastType;
  title: string;
  message: string;
  action?: ToastAction;
}

type ToastInput = Omit<ToastItem, "id">;

const listeners = new Set<() => void>();
let toasts: ToastItem[] = [];
let nextId = 1;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function pushToast(input: ToastInput, ttlMs = 5000) {
  const toast: ToastItem = { ...input, id: nextId++ };
  toasts = [toast, ...toasts].slice(0, 4);
  emit();

  window.setTimeout(() => {
    removeToast(toast.id);
  }, ttlMs);
}

export function removeToast(id: number) {
  const before = toasts.length;
  toasts = toasts.filter((toast) => toast.id !== id);
  if (toasts.length !== before) {
    emit();
  }
}

export function useToastStore() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
    () => []
  );
}
