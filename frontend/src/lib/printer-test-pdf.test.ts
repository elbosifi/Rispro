import { describe, expect, it } from "vitest";
import { createDefaultQzPrinterSettings } from "@/services/printing/workstation-printer-settings";
import { createPrinterTestPdfBlob } from "./printer-test-pdf";

describe("printer test PDF", () => {
  it("generates an exact-size PDF instead of HTML", async () => {
    const profile = { ...createDefaultQzPrinterSettings().profiles[2], printerName: "Xprinter 50x30" };
    const blob = createPrinterTestPdfBlob(profile, new Date("2026-08-01T12:00:00.000Z"));
    const pdf = new TextDecoder("latin1").decode(await blob.arrayBuffer());
    expect(blob.type).toBe("application/pdf");
    expect(pdf.slice(0, 5)).toBe("%PDF-");
    expect(pdf).toMatch(/\/MediaBox\s*\[0 0 (?:141\.7\d*) (?:85\.0\d*)\]/);
    expect(pdf).toContain("RISpro printer test");
    expect(pdf).toContain("Xprinter 50x30");
  });
});
