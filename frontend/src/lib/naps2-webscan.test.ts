import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNaps2WebScanStatus, scanAppointmentRequest } from "./naps2-webscan";

function response(input: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  blob?: Blob;
  json?: unknown;
} = {}): Response {
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    headers: {
      get: (name: string) => input.headers?.[name] ?? input.headers?.[name.toLowerCase()] ?? null,
    },
    blob: async () => input.blob ?? new Blob(["%PDF-1.4"], { type: "application/pdf" }),
    json: async () => input.json ?? {},
  } as Response;
}

describe("naps2 webscan adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("checks the RISpro Scanner Bridge before diagnostic NAPS2 endpoints", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "http://localhost:9810/health") {
        return response();
      }
      throw new Error("not here");
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await getNaps2WebScanStatus();

    expect(status).toEqual({ available: true, endpoint: "http://localhost:9810", kind: "rispro_bridge" });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9810/health", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:9810/health", expect.any(Object));
  });

  it("uses configured bridge endpoint instead of default probes", async () => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);

    const status = await getNaps2WebScanStatus("http://configured.local:9810/");

    expect(status.endpoint).toBe("http://configured.local:9810");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://configured.local:9810/health", expect.any(Object));
  });

  it("scans through the RISpro Scanner Bridge /scan API", async () => {
    let scanBody = "";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://localhost:9810/health") return response();
      if (url === "http://localhost:9810/scan") {
        scanBody = String(init?.body || "");
        return response({
          headers: { "X-RISpro-Page-Count": "2" },
          blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }),
        });
      }
      return response({ ok: false, status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scanAppointmentRequest({ endpoint: "http://localhost:9810", source: "feeder" });

    expect(result.file.type).toBe("application/pdf");
    expect(result.pageCount).toBe(2);
    expect(JSON.parse(scanBody)).toEqual({ dpi: 200, colorMode: "grayscale", source: "feeder" });
  });

  it("reports when NAPS2 is reachable but the RISpro Scanner Bridge is not running", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:9801/eSCL/ScannerCapabilities") return response();
      throw new Error("bridge missing");
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await getNaps2WebScanStatus();

    expect(status.available).toBe(false);
    expect(status.kind).toBe("naps2_direct");
    expect(status.message).toBe("NAPS2 is working, but RISpro Scanner Bridge is not running.");
  });

  it("does not use the direct NAPS2 endpoint for scanning", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:9801/eSCL/ScannerCapabilities") return response();
      return response({ ok: false, status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanAppointmentRequest({ endpoint: "http://127.0.0.1:9801" }))
      .rejects.toThrow("NAPS2 is working, but RISpro Scanner Bridge is not running.");
  });
});
