import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exportAllProtocolLibraryWorkbooks,
  exportProtocolLibraryProtocolWorkbook,
  exportProtocolLibraryVersionWorkbook,
} from "./doctor-portal-reporting";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Protocol Library XLSX export downloads", () => {
  it("uses the canonical all, protocol, and explicit-version export endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Disposition": 'attachment; filename="rispro-protocols.xlsx"' }),
      blob: async () => new Blob(["xlsx"]),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:protocol-export"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await exportAllProtocolLibraryWorkbooks();
    await exportProtocolLibraryProtocolWorkbook(101);
    await exportProtocolLibraryVersionWorkbook(202);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/doctor/protocol-library/protocols/export.xlsx",
      "/api/doctor/protocol-library/protocols/101/export.xlsx",
      "/api/doctor/protocol-library/protocol-versions/202/export.xlsx",
    ]);
  });
});
