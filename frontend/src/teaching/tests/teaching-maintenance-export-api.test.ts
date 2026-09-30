import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadTeachingMaintenanceWorkbook } from "../api/teaching-api";

const fetchMock = vi.fn();
const clickedAnchors: HTMLAnchorElement[] = [];

describe("Teaching maintenance workbook export API", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    clickedAnchors.length = 0;
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:teaching-maintenance"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clickedAnchors.push(this); });
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the all-question endpoint and generic filename when filters are omitted", async () => {
    await downloadTeachingMaintenanceWorkbook();

    expect(fetchMock).toHaveBeenCalledWith("/api/teaching/admin/questions/export.xlsx", { credentials: "include", cache: "no-store" });
    expect(clickedAnchors[0]?.download).toBe("rispro-teaching-question-bank-maintenance.xlsx");
  });

  it("encodes supplied filters, omits blanks, and creates a scoped filename", async () => {
    await downloadTeachingMaintenanceWorkbook({
      status: "draft",
      domainCode: "neuroradiology",
      topicCode: "brain-tumors",
      specialtyCode: "   ",
      search: "brain & spine",
      hasImage: false,
    });

    const endpoint = fetchMock.mock.calls[0]?.[0] as string;
    const params = new URLSearchParams(endpoint.split("?")[1]);
    expect(endpoint.startsWith("/api/teaching/admin/questions/export.xlsx?")).toBe(true);
    expect(params.get("status")).toBe("draft");
    expect(params.get("domainCode")).toBe("neuroradiology");
    expect(params.get("topicCode")).toBe("brain-tumors");
    expect(params.get("search")).toBe("brain & spine");
    expect(params.get("hasImage")).toBe("false");
    expect(params.has("specialtyCode")).toBe(false);
    expect(clickedAnchors[0]?.download).toBe("rispro-teaching-maintenance-draft-neuroradiology-brain-tumors.xlsx");
  });
});
