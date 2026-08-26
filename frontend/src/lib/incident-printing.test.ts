import { beforeEach, describe, expect, it, vi } from "vitest";
import { printIncidentReport } from "./incident-printing";

describe("printIncidentReport", () => {
  const write = vi.fn();
  beforeEach(() => { write.mockReset(); vi.stubGlobal("window", { open: vi.fn(() => ({ document: { write, close: vi.fn() } })) }); });
  it("renders localized LTR output and escapes user content", () => {
    printIncidentReport({ incidentNumber: "INC-1", description: "<script>", equipment_name: "CT One" }, [{ original_filename: "<x>.pdf" }], "en");
    const html = String(write.mock.calls[0][0]); expect(html).toContain('dir="ltr"'); expect(html).toContain("National Cancer Center Benghazi"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("&lt;x&gt;.pdf"); expect(html).toContain("direction:ltr");
  });
  it("renders RTL Arabic while retaining raw equipment name", () => { printIncidentReport({ incidentNumber: "INC-2", equipment_name: "MRI Scanner A" }, [], "ar"); const html = String(write.mock.calls[0][0]); expect(html).toContain('dir="rtl"'); expect(html).toContain("المركز الوطني للأورام بنغازي"); expect(html).toContain("MRI Scanner A"); });
});
