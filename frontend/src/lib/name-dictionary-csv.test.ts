import { afterEach, describe, expect, it, vi } from "vitest";
import { exportDictionaryCsv, parseDictionaryCsv, serializeDictionaryCsv } from "./name-dictionary-csv";

const entries = [
  { arabicText: "عبد الرحمن", englishText: "Abdulrahman" },
  { arabicText: 'اسم، عربي\nثان', englishText: 'Name, "quoted"\nSecond' },
];

afterEach(() => vi.restoreAllMocks());

describe("dictionary CSV", () => {
  it("round-trips Arabic, BOM, commas, quotation marks and multiline fields", () => {
    const csv = serializeDictionaryCsv(entries);
    expect(csv.startsWith("\uFEFFarabic,english\r\n")).toBe(true);
    expect(parseDictionaryCsv(csv)).toEqual(entries);
  });

  it.each(["arabic,english", "arabic_text,english_text", "arabicText,englishText", "العربي,الإنجليزي"])("recognizes header %s", (header) => {
    expect(parseDictionaryCsv(`\uFEFF${header}\r\nمحمد,Mohamed\r\n`)).toEqual([{ arabicText: "محمد", englishText: "Mohamed" }]);
  });

  it("accepts existing headerless files and blank lines", () => {
    expect(parseDictionaryCsv("\nمحمد,Mohamed\n\nعلي,Ali\n")).toHaveLength(2);
  });

  it.each(['"محمد,Mohamed', 'محمد,"Name"broken', "محمد,", "محمد,Mohamed,extra", "arabic,english", "", `محمد,${"a".repeat(1001)}`])("rejects invalid input without silently skipping rows: %s", (csv) => {
    expect(() => parseDictionaryCsv(csv)).toThrow();
  });

  it("exports fresh active entries and the required filename, releasing the object URL", async () => {
    const create = vi.fn((blob: Blob) => { expect(blob.type).toBe("text/csv;charset=utf-8"); return "blob:dictionary"; });
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const fresh = vi.fn().mockResolvedValue({ entries: [...entries, { arabicText: "معطل", englishText: "Inactive", isActive: false }] });
    try {
      expect(await exportDictionaryCsv(fresh, new Date("2026-10-20T12:00:00Z"))).toBe(2);
      expect(fresh).toHaveBeenCalledTimes(1);
      expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe("RISpro_Name_Dictionary_2026-10-20.csv");
      const csv = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(create.mock.calls[0][0]); });
      expect(parseDictionaryCsv(csv)).toHaveLength(2);
      expect(csv).not.toContain("Inactive");
      expect(revoke).toHaveBeenCalledWith("blob:dictionary");
    } finally { vi.unstubAllGlobals(); }
  });

  it("never creates a download when the fresh GET fails", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await expect(exportDictionaryCsv(async () => { throw new TypeError("offline"); })).rejects.toThrow("offline");
    expect(click).not.toHaveBeenCalled();
  });
});
