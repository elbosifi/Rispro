import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
export type RequestScanBarcodeFailure = "no_barcode" | "no_valid_accession" | "multiple_accessions" | "unsupported_file" | "corrupt_file" | "barcode_tool_failed" | "pdf_render_failed";
export type RequestScanBarcodeResult = { ok: true; accession: string } | { ok: false; reason: RequestScanBarcodeFailure };
export type RequestScanBarcodeDependencies = { execFile(command: string, args: string[], options: { timeout: number; maxBuffer: number }): Promise<{ stdout?: string; stderr?: string }> };
const defaultDependencies: RequestScanBarcodeDependencies = { execFile };
const ACCESSION = /^V2-\d{6,}$/i;

export function interpretRequestScanBarcodes(output: string): RequestScanBarcodeResult {
  const decoded = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!decoded.length) return { ok: false, reason: "no_barcode" };
  const accepted = decoded
    .map((line) => line.match(/^(?:CODE-?39|CODE-?128)\s*:\s*(.+)$/i)?.[1]?.replace(/\s+/g, "").toUpperCase() || null)
    .filter((value): value is string => Boolean(value));
  if (!accepted.length) return { ok: false, reason: "no_valid_accession" };
  const accessions = [...new Set(accepted.filter((value) => ACCESSION.test(value)))];
  if (!accessions.length) return { ok: false, reason: "no_valid_accession" };
  if (accessions.length > 1) return { ok: false, reason: "multiple_accessions" };
  return { ok: true, accession: accessions[0] };
}

type ZbarResult = { kind: "decoded"; output: string } | { kind: "no_symbol" } | { kind: "failure" };

function zbarNoSymbol(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const processError = error as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown; killed?: unknown; signal?: unknown; timedOut?: unknown };
  if (processError.killed || processError.signal || processError.timedOut || processError.code === "ETIMEDOUT") return false;
  const text = `${String(processError.stdout || "")} ${String(processError.stderr || "")} ${processError.message || ""}`;
  return Number(processError.code) === 4 || /no symbols? found/i.test(text);
}

async function zbar(filePath: string, dependencies: RequestScanBarcodeDependencies): Promise<ZbarResult> {
  try {
    const result = await dependencies.execFile("zbarimg", ["--quiet", "--set", "*.enable=0", "--set", "code39.enable=1", "--set", "code128.enable=1", filePath], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const output = String(result.stdout || "");
    return output.trim() ? { kind: "decoded", output } : { kind: "no_symbol" };
  } catch (error) {
    return zbarNoSymbol(error) ? { kind: "no_symbol" } : { kind: "failure" };
  }
}

export async function extractRequestScanBarcode(filePath: string, dependencies: RequestScanBarcodeDependencies = defaultDependencies): Promise<RequestScanBarcodeResult> {
  const extension = path.extname(filePath).toLowerCase();
  if (![".pdf", ".jpg", ".jpeg"].includes(extension)) return { ok: false, reason: "unsupported_file" };
  if (extension !== ".pdf") {
    const result = await zbar(filePath, dependencies);
    return result.kind === "failure" ? { ok: false, reason: "barcode_tool_failed" } : interpretRequestScanBarcodes(result.kind === "decoded" ? result.output : "");
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-"));
  try {
    const prefix = path.join(tempDir, "page");
    try { await dependencies.execFile("pdftoppm", ["-r", "300", "-png", filePath, prefix], { timeout: 120_000, maxBuffer: 1024 * 1024 }); }
    catch { return { ok: false, reason: "pdf_render_failed" }; }
    const pages = (await fs.readdir(tempDir)).filter((name) => /^page-\d+\.png$/i.test(name)).sort();
    if (!pages.length) return { ok: false, reason: "corrupt_file" };
    const output: string[] = [];
    for (const page of pages) {
      const result = await zbar(path.join(tempDir, page), dependencies);
      if (result.kind === "failure") return { ok: false, reason: "barcode_tool_failed" };
      if (result.kind === "decoded") output.push(result.output);
    }
    return interpretRequestScanBarcodes(output.join("\n"));
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}
