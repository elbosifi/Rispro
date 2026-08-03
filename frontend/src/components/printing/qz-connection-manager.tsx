import { useEffect } from "react";
import { connectQzTray, isQzConnected } from "@/services/printing/qz-tray-service";
import { loadQzPrinterSettings } from "@/services/printing/workstation-printer-settings";

const RETRY_DELAYS_MS = [0, 2_000, 10_000] as const;

export function QzConnectionManager({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let cycle = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let connectionInFlight = false;
    let restartAfterConnection = false;

    const hasConfiguredPrinter = () => loadQzPrinterSettings().profiles.some(
      (profile) => profile.enabled && profile.printerName.trim().length > 0,
    );

    const attemptConnection = async (attempt: number, currentCycle: number) => {
      if (disposed || currentCycle !== cycle || isQzConnected() || !hasConfiguredPrinter()) return;
      if (connectionInFlight) {
        restartAfterConnection = true;
        return;
      }

      connectionInFlight = true;
      try {
        await connectQzTray();
      } catch {
        const nextAttempt = attempt + 1;
        if (!disposed && currentCycle === cycle && nextAttempt < RETRY_DELAYS_MS.length) {
          retryTimer = setTimeout(
            () => void attemptConnection(nextAttempt, currentCycle),
            RETRY_DELAYS_MS[nextAttempt],
          );
        }
      } finally {
        connectionInFlight = false;
        if (restartAfterConnection && !disposed) {
          restartAfterConnection = false;
          startConnectionCycle();
        }
      }
    };

    const startConnectionCycle = () => {
      cycle += 1;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      if (connectionInFlight) {
        restartAfterConnection = true;
        return;
      }
      void attemptConnection(0, cycle);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startConnectionCycle();
    };

    window.addEventListener("focus", startConnectionCycle);
    window.addEventListener("rispro-qz-settings-changed", startConnectionCycle);
    document.addEventListener("visibilitychange", onVisibilityChange);
    startConnectionCycle();

    return () => {
      disposed = true;
      cycle += 1;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      window.removeEventListener("focus", startConnectionCycle);
      window.removeEventListener("rispro-qz-settings-changed", startConnectionCycle);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);

  return null;
}
