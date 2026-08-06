import { useSyncExternalStore } from "react";

export type GlobalPrintStatus = {
  state: "idle" | "preparing" | "submitting" | "submitted" | "failed" | "status_unknown";
  printerName?: string;
};

export const PRINT_STATUS_SUCCESS_DISMISS_MS = 4_500;

const idleStatus: GlobalPrintStatus = { state: "idle" };
let currentStatus = idleStatus;
let currentJobKey: string | undefined;
let dismissTimer: number | undefined;
const listeners = new Set<() => void>();

function notify(): void { listeners.forEach((listener) => listener()); }

export function setGlobalPrintStatus(status: GlobalPrintStatus, jobKey?: string): void {
  if (jobKey) {
    if (status.state === "preparing") currentJobKey = jobKey;
    else if (currentJobKey !== jobKey) return;
  }
  if (dismissTimer !== undefined) {
    window.clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }
  currentStatus = status;
  notify();
  if (status.state === "submitted") {
    dismissTimer = window.setTimeout(() => {
      dismissTimer = undefined;
      currentStatus = idleStatus;
      currentJobKey = undefined;
      notify();
    }, PRINT_STATUS_SUCCESS_DISMISS_MS);
  }
}

export function getGlobalPrintStatus(): GlobalPrintStatus { return currentStatus; }
export function subscribeToGlobalPrintStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGlobalPrintStatus(): GlobalPrintStatus {
  return useSyncExternalStore(subscribeToGlobalPrintStatus, getGlobalPrintStatus, () => idleStatus);
}

export function resetGlobalPrintStatusForTests(): void {
  if (dismissTimer !== undefined) window.clearTimeout(dismissTimer);
  dismissTimer = undefined;
  currentStatus = idleStatus;
  currentJobKey = undefined;
  notify();
}
