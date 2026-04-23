import { useCallback } from "react";

interface ScanAppOptions {
  url?: string;
  startCommand?: string;
  connectTimeoutMs?: number;
  firstPageTimeoutMs?: number;
  pageInactivityMs?: number;
}

const DEFAULT_OPTIONS: Required<ScanAppOptions> = {
  url: "ws://localhost:8181",
  startCommand: "1100",
  connectTimeoutMs: 5000,
  firstPageTimeoutMs: 20000,
  pageInactivityMs: 1200,
};

function normalizeToBlob(payload: unknown): Blob | null {
  if (payload instanceof Blob) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Blob([payload], { type: "application/octet-stream" });
  }
  if (ArrayBuffer.isView(payload)) {
    const view = payload as ArrayBufferView;
    const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    return new Blob([copy], { type: "application/octet-stream" });
  }
  return null;
}

export function useScanAppForWeb() {
  const isSupported = typeof window !== "undefined" && typeof WebSocket !== "undefined";

  const scanPages = useCallback(
    (customOptions: ScanAppOptions = {}): Promise<Blob[]> => {
      if (!isSupported) {
        return Promise.reject(new Error("This browser does not support local scanner bridge connections."));
      }

      const options = { ...DEFAULT_OPTIONS, ...customOptions };

      return new Promise<Blob[]>((resolve, reject) => {
        const scannedPages: Blob[] = [];
        let socket: WebSocket | null = null;
        let isSettled = false;
        let connectTimeout: ReturnType<typeof setTimeout> | null = null;
        let firstPageTimeout: ReturnType<typeof setTimeout> | null = null;
        let inactivityTimeout: ReturnType<typeof setTimeout> | null = null;

        function clearTimers() {
          if (connectTimeout) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
          if (firstPageTimeout) {
            clearTimeout(firstPageTimeout);
            firstPageTimeout = null;
          }
          if (inactivityTimeout) {
            clearTimeout(inactivityTimeout);
            inactivityTimeout = null;
          }
        }

        function finalizeSuccess() {
          if (isSettled) return;
          isSettled = true;
          clearTimers();
          const resolvedPages = scannedPages.slice();
          if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            socket.close();
          }
          resolve(resolvedPages);
        }

        function finalizeFailure(errorMessage: string) {
          if (isSettled) return;
          isSettled = true;
          clearTimers();
          if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            socket.close();
          }
          reject(new Error(errorMessage));
        }

        function bumpInactivityTimeout() {
          if (inactivityTimeout) {
            clearTimeout(inactivityTimeout);
          }
          inactivityTimeout = setTimeout(() => {
            if (scannedPages.length === 0) {
              finalizeFailure("No scanned pages were returned by ScanAppForWeb.");
              return;
            }
            finalizeSuccess();
          }, options.pageInactivityMs);
        }

        try {
          socket = new WebSocket(options.url);
          socket.binaryType = "blob";
        } catch {
          finalizeFailure("Failed to connect to ScanAppForWeb bridge.");
          return;
        }

        connectTimeout = setTimeout(() => {
          finalizeFailure("Timed out while connecting to ScanAppForWeb bridge.");
        }, options.connectTimeoutMs);

        socket.onopen = () => {
          if (connectTimeout) {
            clearTimeout(connectTimeout);
            connectTimeout = null;
          }
          try {
            socket?.send(options.startCommand);
          } catch {
            finalizeFailure("Connected to scanner bridge but failed to start scan.");
            return;
          }

          firstPageTimeout = setTimeout(() => {
            finalizeFailure("No scanned pages received from scanner bridge.");
          }, options.firstPageTimeoutMs);
        };

        socket.onmessage = (event) => {
          if (isSettled) return;
          const blob = normalizeToBlob(event.data);
          if (!blob || blob.size === 0) {
            return;
          }
          scannedPages.push(blob);
          if (firstPageTimeout) {
            clearTimeout(firstPageTimeout);
            firstPageTimeout = null;
          }
          bumpInactivityTimeout();
        };

        socket.onerror = () => {
          if (scannedPages.length > 0) {
            finalizeSuccess();
            return;
          }
          finalizeFailure("Scanner bridge connection failed.");
        };

        socket.onclose = () => {
          if (isSettled) return;
          if (scannedPages.length > 0) {
            finalizeSuccess();
            return;
          }
          finalizeFailure("Scanner bridge closed before returning scanned pages.");
        };
      });
    },
    [isSupported]
  );

  return {
    isSupported,
    scanPages,
  };
}

