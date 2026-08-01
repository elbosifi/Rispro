import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { createAccessionLabelPdfBlob } from "./accession-label-printing";
import { __pdfTextTestables } from "./pdf-text-utils";

describe("accession label PDF", () => {
  beforeEach(async () => {
    __pdfTextTestables.resetFontCache();
    const regular = await readFile(resolve(process.cwd(), "src/assets/fonts/NotoNaskhArabic-Regular.ttf"));
    const bold = await readFile(resolve(process.cwd(), "src/assets/fonts/NotoNaskhArabic-Bold.ttf"));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(String(url).includes("Bold") ? bold : regular)));
  });
  afterEach(() => vi.unstubAllGlobals());
  it("creates an exact-profile PDF containing the appointment label fields", async () => {
    const appointment = {
      id: 7,
      arabicFullName: "Test Patient",
      englishFullName: "Test Patient",
      accessionNumber: "ACC-0007",
      modalityCode: "CT",
      modalityNameEn: "CT",
      appointmentDate: "2026-08-01",
      mrn: "MRN-7",
    } as AppointmentWithDetails;
    const blob = await createAccessionLabelPdfBlob(appointment, { widthMm: 50, heightMm: 30 });
    const prefix = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5));
    expect(blob.type).toBe("application/pdf");
    expect(prefix).toBe("%PDF-");
    expect(blob.size).toBeGreaterThan(500);
  });

  it("embeds Noto Naskh, shapes Arabic, and preserves exact 50 x 30 mm dimensions", async () => {
    const appointment = { id: 8, arabicFullName: "محمد أحمد علي", englishFullName: "Mohamed Ahmed Ali", accessionNumber: "ACC-0008", modalityCode: "CT", appointmentDate: "2026-08-01", mrn: "MRN-8" } as AppointmentWithDetails;
    const blob = await createAccessionLabelPdfBlob(appointment, { widthMm: 50, heightMm: 30 });
    const pdf = new TextDecoder("latin1").decode(await blob.arrayBuffer());
    expect(pdf).toContain("NotoNaskhArabic");
    expect(pdf).toMatch(/\/MediaBox\s*\[0 0 (?:141\.7\d*) (?:85\.0\d*)\]/);
  });

  it("recovers Arabic label generation after a temporary font fetch failure", async () => {
    const regular = await readFile(resolve(process.cwd(), "src/assets/fonts/NotoNaskhArabic-Regular.ttf"));
    const bold = await readFile(resolve(process.cwd(), "src/assets/fonts/NotoNaskhArabic-Bold.ttf"));
    let failed = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!failed) { failed = true; return new Response(null, { status: 503 }); }
      return new Response(String(url).includes("Bold") ? bold : regular);
    }));
    const appointment = { id: 9, arabicFullName: "محمد أحمد علي", englishFullName: "Mohamed Ahmed Ali", accessionNumber: "ACC-0009", modalityCode: "CT", appointmentDate: "2026-08-01", mrn: "MRN-9" } as AppointmentWithDetails;
    await expect(createAccessionLabelPdfBlob(appointment, { widthMm: 50, heightMm: 30 })).rejects.toThrow(/Failed to load font/);
    const blob = await createAccessionLabelPdfBlob(appointment, { widthMm: 50, heightMm: 30 });
    const pdf = new TextDecoder("latin1").decode(await blob.arrayBuffer());
    expect(pdf).toContain("NotoNaskhArabic");
    expect(pdf).toMatch(/\/MediaBox\s*\[0 0 (?:141\.7\d*) (?:85\.0\d*)\]/);
  });
});
