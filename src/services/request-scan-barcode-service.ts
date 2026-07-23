import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFile = promisify(execFileCallback);
export type RequestScanBarcodeFailure = "no_barcode" | "no_valid_accession" | "multiple_accessions" | "unsupported_file" | "corrupt_file" | "barcode_tool_failed" | "pdf_render_failed" | "image_preprocess_failed";
export type RequestScanBarcodeResult = { ok: true; accession: string } | { ok: false; reason: RequestScanBarcodeFailure };
export type RequestScanBarcodeDependencies = {
  execFile(command: string, args: string[], options: { timeout: number; maxBuffer: number }): Promise<{ stdout?: string; stderr?: string }>;
  imageProcessor?: {
    preprocess(sourcePath: string, destinationPath: string): Promise<void>;
    rotate(sourcePath: string, angle: 90 | 180 | 270, destinationPath: string): Promise<void>;
  };
  logDiagnostic?: (event: string, metadata: Record<string, string | number | boolean>) => void;
};

const defaultImageProcessor = {
  async preprocess(sourcePath: string, destinationPath: string): Promise<void> {
    await sharp(sourcePath).grayscale().normalise().sharpen({ sigma: 1, m1: 0.5, m2: 0 }).png().toFile(destinationPath);
  },
  async rotate(sourcePath: string, angle: 90 | 180 | 270, destinationPath: string): Promise<void> {
    await sharp(sourcePath).rotate(angle).png().toFile(destinationPath);
  },
};
const defaultDependencies: RequestScanBarcodeDependencies = {
  execFile,
  imageProcessor: defaultImageProcessor,
  logDiagnostic(event, metadata) { console.info("[RequestScanBarcode]", event, metadata); },
};
const ACCESSION = /^V2-\d{6,}$/i;
const ZBAR_OPTIONS = { timeout: 30_000, maxBuffer: 1024 * 1024 };
const PDF_OPTIONS = { timeout: 120_000, maxBuffer: 1024 * 1024 };
const IMAGE_PROCESSING_TIMEOUT_MS = 30_000;

export function normalizeAndValidateAccession(candidate: string): string | null {
  const normalized = candidate.replace(/\s+/g, "").toUpperCase();
  return ACCESSION.test(normalized) ? normalized : null;
}

function decodedBarcodeValues(output: string): { decoded: boolean; accessions: string[] } {
  const decoded = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const accessions = decoded
    .map((line) => line.match(/^(?:CODE-?39|CODE-?128)\s*:\s*(.+)$/i)?.[1] || null)
    .map((candidate) => candidate ? normalizeAndValidateAccession(candidate) : null)
    .filter((value): value is string => Boolean(value));
  return { decoded: decoded.length > 0, accessions: [...new Set(accessions)] };
}

export function interpretRequestScanBarcodes(output: string): RequestScanBarcodeResult {
  const result = decodedBarcodeValues(output);
  if (!result.decoded) return { ok: false, reason: "no_barcode" };
  if (!result.accessions.length) return { ok: false, reason: "no_valid_accession" };
  if (result.accessions.length > 1) return { ok: false, reason: "multiple_accessions" };
  return { ok: true, accession: result.accessions[0] };
}

type ZbarResult = { kind: "decoded"; output: string } | { kind: "no_symbol" } | { kind: "failure" };
type PageDecodeResult = { accessions: string[]; decoded: boolean; attempts: number; successfulAttempt: "original" | "preprocessed" | "rotation" | null; rotation: number | null } | { failure: "barcode_tool_failed" | "image_preprocess_failed"; attempts: number };
type DecodeAttemptResult = { accessions: string[] } | { failure: "barcode_tool_failed" };

function zbarNoSymbol(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const processError = error as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown; killed?: unknown; signal?: unknown; timedOut?: unknown };
  if (processError.killed || processError.signal || processError.timedOut || processError.code === "ETIMEDOUT") return false;
  const text = `${String(processError.stdout || "")} ${String(processError.stderr || "")} ${processError.message || ""}`;
  return Number(processError.code) === 4 || /no symbols? found/i.test(text);
}

async function decodeBarcodeCandidates(filePath: string, dependencies: RequestScanBarcodeDependencies): Promise<ZbarResult> {
  try {
    const result = await dependencies.execFile("zbarimg", ["--quiet", "--set", "*.enable=0", "--set", "code39.enable=1", "--set", "code128.enable=1", filePath], ZBAR_OPTIONS);
    const output = String(result.stdout || "");
    return output.trim() ? { kind: "decoded", output } : { kind: "no_symbol" };
  } catch (error) {
    return zbarNoSymbol(error) ? { kind: "no_symbol" } : { kind: "failure" };
  }
}

async function preprocessBarcodeImage(sourcePath: string, destinationPath: string, dependencies: RequestScanBarcodeDependencies): Promise<void> {
  await withImageProcessingTimeout((dependencies.imageProcessor ?? defaultImageProcessor).preprocess(sourcePath, destinationPath));
}

async function rotateBarcodeImage(sourcePath: string, angle: 90 | 180 | 270, destinationPath: string, dependencies: RequestScanBarcodeDependencies): Promise<void> {
  await withImageProcessingTimeout((dependencies.imageProcessor ?? defaultImageProcessor).rotate(sourcePath, angle, destinationPath));
}

async function withImageProcessingTimeout(operation: Promise<void>): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Barcode image processing timed out")), IMAGE_PROCESSING_TIMEOUT_MS); }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
}

async function decodePageWithFallbacks(pagePath: string, tempDir: string, pageNumber: number, fileType: "image" | "pdf", dependencies: RequestScanBarcodeDependencies): Promise<PageDecodeResult> {
  let decoded = false;
  let attempts = 0;
  const attempt = async (filePath: string): Promise<DecodeAttemptResult> => {
    attempts += 1;
    const result = await decodeBarcodeCandidates(filePath, dependencies);
    if (result.kind === "failure") return { failure: "barcode_tool_failed" as const };
    if (result.kind === "no_symbol") return { accessions: [] };
    const parsed = decodedBarcodeValues(result.output);
    decoded ||= parsed.decoded;
    return { accessions: parsed.accessions };
  };

  const original = await attempt(pagePath);
  if ("failure" in original) return { failure: original.failure, attempts };
  if (original.accessions.length) {
    dependencies.logDiagnostic?.("recognition_succeeded", { fileType, pageNumber, attempt: "original", rotation: 0, attemptCount: attempts });
    return { accessions: original.accessions, decoded, attempts, successfulAttempt: "original", rotation: 0 };
  }

  const processedPath = path.join(tempDir, `processed-${pageNumber}.png`);
  try { await preprocessBarcodeImage(pagePath, processedPath, dependencies); }
  catch { return { failure: "image_preprocess_failed", attempts }; }
  const processed = await attempt(processedPath);
  if ("failure" in processed) return { failure: processed.failure, attempts };
  if (processed.accessions.length) {
    dependencies.logDiagnostic?.("recognition_succeeded", { fileType, pageNumber, attempt: "preprocessed", rotation: 0, attemptCount: attempts });
    return { accessions: processed.accessions, decoded, attempts, successfulAttempt: "preprocessed", rotation: 0 };
  }

  for (const angle of [90, 180, 270] as const) {
    const rotatedPath = path.join(tempDir, `processed-${pageNumber}-rotated-${angle}.png`);
    try { await rotateBarcodeImage(processedPath, angle, rotatedPath, dependencies); }
    catch { return { failure: "image_preprocess_failed", attempts }; }
    const rotated = await attempt(rotatedPath);
    if ("failure" in rotated) return { failure: rotated.failure, attempts };
    if (rotated.accessions.length) {
      dependencies.logDiagnostic?.("recognition_succeeded", { fileType, pageNumber, attempt: "rotation", rotation: angle, attemptCount: attempts });
      return { accessions: rotated.accessions, decoded, attempts, successfulAttempt: "rotation", rotation: angle };
    }
  }
  return { accessions: [], decoded, attempts, successfulAttempt: null, rotation: null };
}

export async function extractRequestScanBarcode(filePath: string, dependencies: RequestScanBarcodeDependencies = defaultDependencies): Promise<RequestScanBarcodeResult> {
  const extension = path.extname(filePath).toLowerCase();
  if (![".pdf", ".jpg", ".jpeg"].includes(extension)) return { ok: false, reason: "unsupported_file" };
  const fileType = extension === ".pdf" ? "pdf" : "image";
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-"));
  try {
    let pages: string[];
    if (fileType === "pdf") {
      const prefix = path.join(tempDir, "page");
      try { await dependencies.execFile("pdftoppm", ["-r", "300", "-png", filePath, prefix], PDF_OPTIONS); }
      catch { return { ok: false, reason: "pdf_render_failed" }; }
      pages = (await fs.readdir(tempDir)).filter((name) => /^page-\d+\.png$/i.test(name)).sort().map((name) => path.join(tempDir, name));
      if (!pages.length) return { ok: false, reason: "corrupt_file" };
    } else pages = [filePath];

    const accessions = new Set<string>();
    let decoded = false;
    let attemptCount = 0;
    for (const [index, page] of pages.entries()) {
      const pageResult = await decodePageWithFallbacks(page, tempDir, index + 1, fileType, dependencies);
      if ("failure" in pageResult) {
        dependencies.logDiagnostic?.("recognition_failed", { fileType, pageNumber: index + 1, category: pageResult.failure, attemptCount: attemptCount + pageResult.attempts });
        return { ok: false, reason: pageResult.failure };
      }
      decoded ||= pageResult.decoded;
      attemptCount += pageResult.attempts;
      for (const accession of pageResult.accessions) accessions.add(accession);
    }
    const result = !accessions.size ? { ok: false as const, reason: decoded ? "no_valid_accession" as const : "no_barcode" as const }
      : accessions.size > 1 ? { ok: false as const, reason: "multiple_accessions" as const }
      : { ok: true as const, accession: [...accessions][0] };
    dependencies.logDiagnostic?.("recognition_complete", { fileType, pageCount: pages.length, attemptCount, category: result.ok ? "success" : result.reason, uniqueAccessions: accessions.size });
    return result;
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}
