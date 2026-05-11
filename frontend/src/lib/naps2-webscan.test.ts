import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNaps2WebScanStatus, scanAppointmentRequest } from "./naps2-webscan";

function response(input: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  blob?: Blob;
} = {}): Response {
  return {
    ok: input.ok ?? true,
    status: input.status ?? 200,
    headers: {
      get: (name: string) => input.headers?.[name] ?? input.headers?.[name.toLowerCase()] ?? null,
    },
    blob: async () => input.blob ?? new Blob(["%PDF-1.4"], { type: "application/pdf" }),
  } as Response;
}

describe("naps2 webscan adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("checks localhost:9801 while probing default NAPS2 scanner-sharing endpoints", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "http://localhost:9801/eSCL/ScannerCapabilities") {
        return response();
      }
      throw new Error("not here");
    });
    vi.stubGlobal("fetch", fetchMock);

    const status = await getNaps2WebScanStatus();

    expect(status).toEqual({ available: true, endpoint: "http://localhost:9801" });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9801/eSCL/ScannerCapabilities", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:9801/eSCL/ScannerCapabilities", expect.any(Object));
  });

  it("uses configured endpoint instead of default probes", async () => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);

    const status = await getNaps2WebScanStatus("http://configured.local:9801/");

    expect(status.endpoint).toBe("http://configured.local:9801");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://configured.local:9801/eSCL/ScannerCapabilities", expect.any(Object));
  });

  it("creates ESCL scan jobs with scan InputSource and PDF document format", async () => {
    let scanJobBody = "";
    let nextDocumentCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://localhost:9801/eSCL/ScannerCapabilities") return response();
      if (url === "http://localhost:9801/eSCL/ScanJobs") {
        scanJobBody = String(init?.body || "");
        return response({ status: 201, headers: { Location: "http://localhost:9801/eSCL/ScanJobs/job-1" } });
      }
      if (url === "http://localhost:9801/eSCL/ScanJobs/job-1/NextDocument") {
        nextDocumentCount += 1;
        return nextDocumentCount === 1
          ? response({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }) })
          : response({ ok: false, status: 404 });
      }
      return response({ ok: false, status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scanAppointmentRequest({ endpoint: "http://localhost:9801", source: "feeder" });

    expect(result.file.type).toBe("application/pdf");
    expect(scanJobBody).toContain("<pwg:Version>2.6</pwg:Version>");
    expect(scanJobBody).toContain("<scan:Intent>Document</scan:Intent>");
    expect(scanJobBody).toContain("<scan:InputSource>Feeder</scan:InputSource>");
    expect(scanJobBody).not.toContain("<pwg:InputSource>");
    expect(scanJobBody).toContain("<scan:ColorMode>Grayscale8</scan:ColorMode>");
    expect(scanJobBody).toContain("<scan:XResolution>200</scan:XResolution>");
    expect(scanJobBody).toContain("<scan:YResolution>200</scan:YResolution>");
    expect(scanJobBody).toContain("<scan:DocumentFormat>application/pdf</scan:DocumentFormat>");
  });

  it("reports endpoint and HTTP status when capabilities work but scan job creation fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "http://localhost:9801/eSCL/ScannerCapabilities") return response();
      return response({ ok: false, status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanAppointmentRequest({ endpoint: "http://localhost:9801" }))
      .rejects.toThrow("NAPS2.WebScan capabilities were reachable at http://localhost:9801, but scan job creation failed with HTTP 500.");
  });
});
