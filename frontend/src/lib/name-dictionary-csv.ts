import type { DictionaryEntry } from "./name-generation";

type Mapping = Pick<DictionaryEntry, "arabicText" | "englishText">;

export class DictionaryCsvError extends Error {
  constructor(public readonly row: number, public readonly reason: "quotes" | "columns" | "value" | "empty" | "tooLarge") {
    super(`CSV row ${row}: ${reason}`);
  }
}

export function parseDictionaryCsv(input: string): Mapping[] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const finishField = () => { row.push(field.trim()); field = ""; closed = false; };
  const finishRow = () => { finishField(); if (row.some(Boolean)) rows.push(row); row = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === '"') {
      if (field.trim() || closed) throw new DictionaryCsvError(rows.length + 1, "quotes");
      field = ""; quoted = true;
    } else if (char === ",") finishField();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
    } else if (closed) {
      if (!/\s/.test(char)) throw new DictionaryCsvError(rows.length + 1, "quotes");
    } else field += char;
  }
  if (quoted) throw new DictionaryCsvError(rows.length + 1, "quotes");
  finishRow();
  const header = rows[0]?.map((part) => part.toLowerCase().replace(/[_\s-]/g, ""));
  const hasHeader = header?.length === 2 &&
    ["arabic", "arabictext", "العربي", "العربية"].includes(header[0]) &&
    ["english", "englishtext", "الإنجليزي", "الانجليزي", "الإنجليزية"].includes(header[1]);
  if (hasHeader) rows.shift();
  if (!rows.length) throw new DictionaryCsvError(1, "empty");
  if (rows.length > 50_000) throw new DictionaryCsvError(1, "tooLarge");
  return rows.map((parts, index) => {
    const rowNumber = index + (hasHeader ? 2 : 1);
    if (parts.length !== 2) throw new DictionaryCsvError(rowNumber, "columns");
    if (parts.some((part) => !part || part.length > 1_000 || part.includes("\0"))) throw new DictionaryCsvError(rowNumber, "value");
    return { arabicText: parts[0], englishText: parts[1] };
  });
}

export function serializeDictionaryCsv(entries: Mapping[]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return "\uFEFFarabic,english\r\n" + entries.map((entry) => `${escape(entry.arabicText)},${escape(entry.englishText)}`).join("\r\n") + "\r\n";
}

export async function exportDictionaryCsv(fetchFresh: () => Promise<{ entries: DictionaryEntry[] }>, now = new Date()): Promise<number> {
  const { entries } = await fetchFresh();
  if (!Array.isArray(entries)) throw new Error("Invalid dictionary response.");
  const active = entries.filter((entry) => entry.isActive !== false).sort((a, b) => a.arabicText.localeCompare(b.arabicText, "ar"));
  const url = URL.createObjectURL(new Blob([serializeDictionaryCsv(active)], { type: "text/csv;charset=utf-8" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    anchor.download = `RISpro_Name_Dictionary_${date}.csv`;
    anchor.click();
  } finally { URL.revokeObjectURL(url); }
  return active.length;
}
