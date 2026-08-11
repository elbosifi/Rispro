import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

describe("comparison request frontend contract", () => {
  it("keeps the Comparison page confirmation-only", () => {
    const page = readFileSync(path.join(root, "src/pages/comparisons/comparisons-page.tsx"), "utf8");
    const drawer = readFileSync(path.join(root, "src/components/patients/patient-drawer.tsx"), "utf8");
    const reportingApi = readFileSync(path.join(root, "src/lib/api/doctor-portal-reporting.ts"), "utf8");

    expect(drawer).toContain("Request comparison");
    expect(page).toContain("Confirm and send to reporting pool");
    expect(page).toContain("previous images are uploaded or available in PACS");
    expect(page).toContain("comparison documents/papers are uploaded or available in PACS");
    expect(reportingApi).toContain("confirmComparisonMaterials");
    expect(page).not.toMatch(/type="file"|attach|filename|mime/i);
  });
});
