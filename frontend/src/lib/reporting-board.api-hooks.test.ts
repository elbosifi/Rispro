import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchReportingBoardCases, fetchReportingBoardStats } from "./api-hooks";

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
});
