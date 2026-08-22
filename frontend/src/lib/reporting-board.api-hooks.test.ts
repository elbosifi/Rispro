import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchReportingBoardCases, fetchReportingBoardStats, queueFullReportingBoardSonicDicomResync, refreshReportingBoardSonicDicom } from "./api-hooks";

vi.mock("@/lib/api-client", () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;

    constructor(message: string, status: number, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  },
}));

describe("reporting board api hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes case source, limit, and offset for cases and stats requests", async () => {
    vi.mocked(api).mockResolvedValue({ cases: [], filters: {} });

    await fetchReportingBoardCases({ reportStatus: "draft", caseSource: "comparisons", limit: 300, offset: 100 });
    await fetchReportingBoardStats({ reportStatus: "draft", caseSource: "comparisons", limit: 300, offset: 100 });

    expect(api).toHaveBeenNthCalledWith(1, "/doctor/reporting-board/cases?reportStatus=draft&caseSource=comparisons&limit=300&offset=100");
    expect(api).toHaveBeenNthCalledWith(2, "/doctor/reporting-board/stats?reportStatus=draft&caseSource=comparisons&limit=300&offset=100");
  });

  it("posts current filters for a manual SonicDICOM refresh", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, checked: 1, successful: 1, failed: 0, checkedAt: "2026-08-19T10:00:00.000Z" });

    await refreshReportingBoardSonicDicom({ reportStatus: "draft", caseSource: "appointments", limit: 100, offset: 0 });

    expect(api).toHaveBeenCalledWith("/doctor/reporting-board/refresh-sonicdicom", {
      method: "POST",
      body: JSON.stringify({ filters: { reportStatus: "draft", caseSource: "appointments", limit: 100, offset: 0 } }),
    });
  });

  it("queues the full SonicDICOM resync without passing board filters", async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, queued: 1234, requestedAt: "2026-08-22T10:00:00.000Z" });

    await queueFullReportingBoardSonicDicomResync();

    expect(api).toHaveBeenCalledWith("/doctor/reporting-board/resync-sonicdicom", { method: "POST" });
  });
});
