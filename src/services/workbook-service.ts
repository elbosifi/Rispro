import { HttpError } from "../utils/http-error.js";

export interface ParsedWorkbookRow {
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface ParsedWorksheet {
  headers: string[];
  rows: ParsedWorkbookRow[];
}

type XlsxModule = typeof import("xlsx");

async function loadXlsx(): Promise<XlsxModule> {
  try {
    return await import("xlsx");
  } catch {
    throw new HttpError(500, "Excel parser dependency is missing. Install 'xlsx'.");
  }
}

export async function readWorkbookFromBase64(fileContentBase64: string) {
  const XLSX = await loadXlsx();
  const binaryBuffer = Buffer.from(String(fileContentBase64 || ""), "base64");

  if (!binaryBuffer.length) {
    throw new HttpError(400, "fileContentBase64 is required.");
  }

  const workbook = XLSX.read(binaryBuffer, { type: "buffer" });
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];

  if (sheetNames.length === 0) {
    throw new HttpError(400, "Workbook does not contain any sheets.");
  }

  return { XLSX, workbook, sheetNames };
}

export function parseWorksheet(
  XLSX: XlsxModule,
  worksheet: import("xlsx").WorkSheet | undefined,
  sheetName: string
): ParsedWorksheet {
  if (!worksheet) {
    throw new HttpError(400, `Worksheet '${sheetName}' is not readable.`);
  }

  const matrixRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false
  });
  const headers = (matrixRows[0] || []).map((value) => String(value || "").trim());

  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: false,
    blankrows: false
  });

  const rows: ParsedWorkbookRow[] = jsonRows.map((values, index) => ({
    rowNumber: index + 2,
    values
  }));

  return { headers, rows };
}

export async function buildWorkbookBuffer(
  sheets: Array<{ name: string; rows: Array<Record<string, unknown>>; headers?: string[] }>
): Promise<Buffer> {
  const XLSX = await loadXlsx();
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows, sheet.headers ? { header: sheet.headers } : undefined);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
