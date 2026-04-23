import { useCallback } from "react";

interface ScanAppOptions {
  url?: string;
  startCommand?: string;
  connectTimeoutMs?: number;
  firstPageTimeoutMs?: number;
  pageInactivityMs?: number;
}

type ResolvedScanAppOptions = Required<ScanAppOptions>;

const DEFAULT_OPTIONS: ResolvedScanAppOptions = {
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
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const copy = new Uint8Array(bytes);
    return new Blob([copy.buffer], { type: "application/octet-stream" });
  }
  return null;
}

function resolveBridgeUrls(customUrl: string | undefined): string[] {
  if (customUrl && customUrl.trim()) {
    return [customUrl.trim()];
  }
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return ["wss://localhost:8181", "ws://localhost:8181"];
  }
  return ["ws://localhost:8181", "wss://localhost:8181"];
}

function scanPagesViaBridgeUrl(url: string, options: ResolvedScanAppOptions): Promise<Blob[]> {
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
          finalizeFailure(`No scanned pages were returned by ScanAppForWeb at ${url}.`);
          return;
        }
        finalizeSuccess();
      }, options.pageInactivityMs);
    }

    try {
      socket = new WebSocket(url);
      socket.binaryType = "blob";
    } catch {
      finalizeFailure(`Failed to connect to scanner bridge at ${url}.`);
      return;
    }

    connectTimeout = setTimeout(() => {
      finalizeFailure(`Timed out while connecting to scanner bridge at ${url}.`);
    }, options.connectTimeoutMs);

    socket.onopen = () => {
      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }
      try {
        socket?.send(options.startCommand);
      } catch {
        finalizeFailure(`Connected to ${url}, but failed to start scan command.`);
        return;
      }

      firstPageTimeout = setTimeout(() => {
        finalizeFailure(`No scanned pages received from scanner bridge at ${url}.`);
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
      finalizeFailure(`Scanner bridge connection failed at ${url}.`);
    };

    socket.onclose = () => {
      if (isSettled) return;
      if (scannedPages.length > 0) {
        finalizeSuccess();
        return;
      }
      finalizeFailure(`Scanner bridge closed before returning scanned pages at ${url}.`);
    };
  });
}

export function useScanAppForWeb() {
  const isSupported = typeof window !== "undefined" && typeof WebSocket !== "undefined";

  const scanPages = useCallback(
    async (customOptions: ScanAppOptions = {}): Promise<Blob[]> => {
      if (!isSupported) {
        return Promise.reject(new Error("This browser does not support local scanner bridge connections."));
      }

      const options: ResolvedScanAppOptions = { ...DEFAULT_OPTIONS, ...customOptions };
      const bridgeUrls = resolveBridgeUrls(customOptions.url);
      const errors: string[] = [];

      for (const bridgeUrl of bridgeUrls) {
        try {
          const pages = await scanPagesViaBridgeUrl(bridgeUrl, options);
          if (pages.length > 0) {
            return pages;
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      const fallbackHelp =
        "Ensure ScanAppForWeb local helper is running on this workstation and listening on localhost:8181.";
      throw new Error(errors.length > 0 ? `${errors.join(" ")} ${fallbackHelp}` : fallbackHelp);
    },
    [isSupported]
  );

  return {
    isSupported,
    scanPages,
  };
}
