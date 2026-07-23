import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { normalizeV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";

const execFile = promisify(execFileCallback);
export type RequestScanBarcodeFailure = "no_barcode" | "no_valid_accession" | "multiple_accessions" | "unsupported_file" | "corrupt_file" | "barcode_decoder_timeout" | "barcode_decoder_failed" | "pdf_render_failed" | "image_preprocess_failed" | "barcode_processing_failed";
export type RequestScanBarcodeResult =
  | { ok: true; accession?: string; qrTokens?: string[]; ignoredQrCount?: number }
  | { ok: false; reason: RequestScanBarcodeFailure; ignoredQrCount?: number };
export type RequestScanBarcodeDependencies = {
  execFile(command: string, args: string[], options: { timeout: number; maxBuffer: number }): Promise<{ stdout?: string; stderr?: string }>;
  imageProcessor?: { preprocess(sourcePath: string, destinationPath: string): Promise<void>; rotate(sourcePath: string, angle: 90 | 180 | 270, destinationPath: string): Promise<void> };
  logDiagnostic?: (event: string, metadata: Record<string, string | number | boolean>) => void;
};
export type RequestScanQrOriginConfiguration = {
  risproPublicBaseUrl?: string;
  publicAppBaseUrl?: string;
  explicitAllowedOrigins?: string;
  onProgress?: (stage: "rendering_300_dpi" | "scanning_original_300_dpi" | "scanning_enhanced_300_dpi" | "rendering_600_dpi" | "scanning_original_600_dpi" | "scanning_enhanced_600_dpi", current?: number, total?: number) => void | Promise<void>;
};

const defaultImageProcessor = {
  async preprocess(sourcePath: string, destinationPath: string): Promise<void> { await sharp(sourcePath).grayscale().normalise().sharpen({ sigma: 1, m1: 0.5, m2: 0 }).png().toFile(destinationPath); },
  async rotate(sourcePath: string, angle: 90 | 180 | 270, destinationPath: string): Promise<void> { await sharp(sourcePath).rotate(angle).png().toFile(destinationPath); },
};
const defaultDependencies: RequestScanBarcodeDependencies = { execFile, imageProcessor: defaultImageProcessor, logDiagnostic(event, metadata) { console.info("[RequestScanBarcode]", event, metadata); } };
const ZBAR_OPTIONS = { timeout: 30_000, maxBuffer: 1024 * 1024 };
const PDF_OPTIONS = { timeout: 120_000, maxBuffer: 1024 * 1024 };
const IMAGE_PROCESSING_TIMEOUT_MS = 30_000;
const PDF_STAGE_TIMEOUT_MS = 300_000;
type FileType = "image" | "pdf";
type SuccessAttempt = "original" | "preprocessed" | "rotated";
type DiagnosticCode = "BARCODE_SUCCESS_ORIGINAL" | "BARCODE_SUCCESS_PREPROCESSED" | "BARCODE_SUCCESS_ROTATED" | "BARCODE_SUCCESS_PDF_600_DPI" | "BARCODE_NOT_DETECTED" | "BARCODE_DETECTED_INVALID_ACCESSION" | "BARCODE_MULTIPLE_VALID_ACCESSIONS" | "BARCODE_PREPROCESSING_FAILED" | "BARCODE_DECODER_TIMEOUT" | "BARCODE_DECODER_FAILED" | "BARCODE_PDF_RENDER_FAILED" | "BARCODE_PROCESSING_FAILED" | "BARCODE_PDF_SCAN_STARTED";

export const normalizeAndValidateAccession = normalizeV2AccessionNumber;
type DecodedBarcodeValues = { decoded: boolean; accessions: string[]; qrTokens: string[]; ignoredQrCount: number };

function configuredHttpsOrigin(value: string, allowExplicitPort = false): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (!allowExplicitPort && parsed.port) || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function trustedRequestScanQrOrigins(configuration: RequestScanQrOriginConfiguration = {}): Set<string> {
  const configured = [
    configuration.risproPublicBaseUrl,
    configuration.publicAppBaseUrl ?? process.env.PUBLIC_APP_BASE_URL,
  ];
  const explicit = (configuration.explicitAllowedOrigins ?? process.env.REQUEST_SCAN_QR_ALLOWED_ORIGINS ?? "").split(",");
  return new Set([
    ...configured.map((value) => configuredHttpsOrigin(String(value ?? ""))),
    ...explicit.map((value) => configuredHttpsOrigin(value, true)),
  ].filter((value): value is string => Boolean(value)));
}

export function extractRisproPublicAppointmentToken(payload: string, allowedOrigins = trustedRequestScanQrOrigins()): string | null {
  let parsed: URL;
  try {
    parsed = new URL(payload);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    !allowedOrigins.has(parsed.origin) ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/public/appointment" ||
    parsed.hash
  ) {
    return null;
  }
  const tokens = parsed.searchParams.getAll("t");
  if (tokens.length !== 1 || !tokens[0]) return null;
  return tokens[0];
}

function decodedBarcodeValues(output: string, allowedOrigins?: Set<string>): DecodedBarcodeValues {
  const decoded = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const accessions = decoded.map((line) => line.match(/^(?:CODE-?39|CODE-?128)\s*:\s*(.+)$/i)?.[1] || null).map((candidate) => candidate ? normalizeAndValidateAccession(candidate) : null).filter((value): value is string => Boolean(value));
  const qrPayloads = decoded.map((line) => line.match(/^QR-?CODE\s*:\s*(.+)$/i)?.[1] || null).filter((value): value is string => Boolean(value));
  const qrTokens = qrPayloads.map((payload) => extractRisproPublicAppointmentToken(payload, allowedOrigins)).filter((value): value is string => Boolean(value));
  return {
    decoded: decoded.length > 0,
    accessions: [...new Set(accessions)],
    qrTokens: [...new Set(qrTokens)],
    ignoredQrCount: qrPayloads.length - qrTokens.length,
  };
}
export function interpretRequestScanBarcodes(output: string, allowedOrigins?: Set<string>): RequestScanBarcodeResult {
  const parsed = decodedBarcodeValues(output, allowedOrigins);
  return summarize({
    accessions: new Set(parsed.accessions),
    qrTokens: new Set(parsed.qrTokens),
    ignoredQrCount: parsed.ignoredQrCount,
    decoded: parsed.decoded,
    attempts: 1,
  });
}

type ZbarResult = { kind: "decoded"; output: string } | { kind: "no_symbol" } | { kind: "timeout" } | { kind: "failure" };
type PageFailure = "barcode_decoder_timeout" | "barcode_decoder_failed" | "image_preprocess_failed" | "barcode_processing_failed";
type PageDecodeResult = { accessions: string[]; qrTokens: string[]; ignoredQrCount: number; decoded: boolean; attempts: number; successfulAttempt: SuccessAttempt | null; rotation: 0 | 90 | 180 | 270 | null; failure?: PageFailure };
type ResolutionResult = { accessions: Set<string>; qrTokens: Set<string>; ignoredQrCount: number; decoded: boolean; attempts: number; failure?: RequestScanBarcodeFailure };
function log(dependencies: RequestScanBarcodeDependencies, code: DiagnosticCode, metadata: Record<string, string | number | boolean>): void { dependencies.logDiagnostic?.("barcode_recognition", { code, ...metadata }); }
function processTimedOut(error: unknown): boolean { return Boolean(error && typeof error === "object" && ((error as NodeJS.ErrnoException & { killed?: unknown; signal?: unknown; timedOut?: unknown }).killed || (error as NodeJS.ErrnoException & { signal?: unknown }).signal || (error as NodeJS.ErrnoException & { timedOut?: unknown }).timedOut || (error as NodeJS.ErrnoException).code === "ETIMEDOUT")); }
function zbarNoSymbol(error: unknown): boolean { if (!error || typeof error !== "object" || processTimedOut(error)) return false; const value = error as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown }; return Number(value.code) === 4 || /no symbols? found/i.test(`${String(value.stdout || "")} ${String(value.stderr || "")} ${value.message || ""}`); }
async function decodeBarcodeCandidates(filePath: string, dependencies: RequestScanBarcodeDependencies): Promise<ZbarResult> { try { const result = await dependencies.execFile("zbarimg", ["--quiet", "--set", "*.enable=0", "--set", "code39.enable=1", "--set", "code128.enable=1", "--set", "qrcode.enable=1", filePath], ZBAR_OPTIONS); const output = String(result.stdout || ""); return output.trim() ? { kind: "decoded", output } : { kind: "no_symbol" }; } catch (error) { return zbarNoSymbol(error) ? { kind: "no_symbol" } : processTimedOut(error) ? { kind: "timeout" } : { kind: "failure" }; } }
async function withImageProcessingTimeout(operation: Promise<void>): Promise<void> { let timeout: NodeJS.Timeout | undefined; try { await Promise.race([operation, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Barcode image processing timed out")), IMAGE_PROCESSING_TIMEOUT_MS); })]); } finally { if (timeout) clearTimeout(timeout); } }
async function decodePageWithFallbacks(pagePath: string, tempDir: string, pageNumber: number, fileType: FileType, dpi: number | "source", dependencies: RequestScanBarcodeDependencies, allowedOrigins?: Set<string>, includeOriginal = true): Promise<PageDecodeResult> {
  let decoded = false; let attempts = 0; let preprocessingFailed = false; let ignoredQrCount = 0;
  const collectedAccessions = new Set<string>(); const collectedQrTokens = new Set<string>();
  let successfulAttempt: SuccessAttempt | null = null; let successfulRotation: 0 | 90 | 180 | 270 | null = null;
  const attempt = async (candidatePath: string): Promise<Omit<DecodedBarcodeValues, "decoded"> | { failure: PageFailure }> => {
    attempts += 1;
    const result = await decodeBarcodeCandidates(candidatePath, dependencies);
    if (result.kind === "timeout") return { failure: "barcode_decoder_timeout" };
    if (result.kind === "failure") return { failure: "barcode_decoder_failed" };
    if (result.kind === "no_symbol") return { accessions: [], qrTokens: [], ignoredQrCount: 0 };
    const parsed = decodedBarcodeValues(result.output, allowedOrigins);
    decoded ||= parsed.decoded;
    ignoredQrCount += parsed.ignoredQrCount;
    return { accessions: parsed.accessions, qrTokens: parsed.qrTokens, ignoredQrCount: parsed.ignoredQrCount };
  };
  const current = (failure?: PageFailure): PageDecodeResult => ({
    accessions: [...collectedAccessions], qrTokens: [...collectedQrTokens], ignoredQrCount, decoded, attempts, successfulAttempt, rotation: successfulRotation, failure,
  });
  const collect = (result: Omit<DecodedBarcodeValues, "decoded">, attemptName: SuccessAttempt, rotation: 0 | 90 | 180 | 270): void => {
    result.accessions.forEach((accession) => collectedAccessions.add(accession));
    result.qrTokens.forEach((token) => collectedQrTokens.add(token));
    if ((result.accessions.length || result.qrTokens.length) && !successfulAttempt) {
      successfulAttempt = attemptName;
      successfulRotation = rotation;
    }
    if (result.accessions.length) {
      successfulAttempt = attemptName;
      successfulRotation = rotation;
    }
  };

  if (includeOriginal) {
    const original = await attempt(pagePath);
    if ("failure" in original) return current(original.failure);
    collect(original, "original", 0);
    if (collectedAccessions.size) return current();
  }
  const processor = dependencies.imageProcessor ?? defaultImageProcessor; const processedPath = path.join(tempDir, `processed-${pageNumber}.png`);
  try { await withImageProcessingTimeout(processor.preprocess(pagePath, processedPath)); } catch { preprocessingFailed = true; log(dependencies, "BARCODE_PREPROCESSING_FAILED", { fileType, pageNumber, dpi, attempt: "preprocessed", rotation: 0 }); }
  if (!preprocessingFailed) {
    const processed = await attempt(processedPath);
    if ("failure" in processed) return collectedQrTokens.size ? current() : current(processed.failure);
    collect(processed, "preprocessed", 0);
    if (collectedAccessions.size) return current();
  }
  if (!preprocessingFailed) for (const angle of [90, 180, 270] as const) {
    const rotatedPath = path.join(tempDir, `processed-${pageNumber}-rotated-${angle}.png`);
    try { await withImageProcessingTimeout(processor.rotate(processedPath, angle, rotatedPath)); } catch { preprocessingFailed = true; log(dependencies, "BARCODE_PREPROCESSING_FAILED", { fileType, pageNumber, dpi, attempt: "rotated", rotation: angle }); continue; }
    const rotated = await attempt(rotatedPath);
    if ("failure" in rotated) return collectedQrTokens.size ? current() : current(rotated.failure);
    collect(rotated, "rotated", angle);
    if (collectedAccessions.size) return current();
  }
  return current(preprocessingFailed && !collectedQrTokens.size ? "image_preprocess_failed" : undefined);
}
function pageFailureCode(failure: PageFailure): DiagnosticCode { return failure === "barcode_decoder_timeout" ? "BARCODE_DECODER_TIMEOUT" : failure === "barcode_decoder_failed" ? "BARCODE_DECODER_FAILED" : failure === "image_preprocess_failed" ? "BARCODE_PREPROCESSING_FAILED" : "BARCODE_PROCESSING_FAILED"; }
type RenderedPage = { pageNumber: number; pagePath: string };
type PdfPass = "original_sweep" | "enhanced_sweep";
function orderedRenderedPages(pagePaths: string[]): RenderedPage[] {
  const pages = pagePaths.map((pagePath) => ({ pagePath, pageNumber: Number(path.basename(pagePath).match(/-(\d+)\.png$/i)?.[1]) }))
    .filter((page): page is RenderedPage => Number.isInteger(page.pageNumber) && page.pageNumber > 0)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  if (pages.length < 2) return pages;
  const last = pages.at(-1)!;
  const first = pages[0]!;
  return [last, first, ...pages.slice(1, -1)];
}
async function scanPdfPass(pages: RenderedPage[], tempDir: string, dpi: 300 | 600, pass: PdfPass, deadline: number, dependencies: RequestScanBarcodeDependencies, allowedOrigins: Set<string>, onProgress?: RequestScanQrOriginConfiguration["onProgress"]): Promise<ResolutionResult> {
  const accessions = new Set<string>(); const qrTokens = new Set<string>(); let ignoredQrCount = 0; let decoded = false; let attempts = 0; let pagesExamined = 0;
  for (const page of pages) {
    await onProgress?.(pass === "original_sweep" ? (dpi === 300 ? "scanning_original_300_dpi" : "scanning_original_600_dpi") : (dpi === 300 ? "scanning_enhanced_300_dpi" : "scanning_enhanced_600_dpi"), pagesExamined, pages.length);
    if (Date.now() > deadline) {
      log(dependencies, "BARCODE_PROCESSING_FAILED", { fileType: "pdf", dpi, currentPass: pass, pagesExamined, totalPageCount: pages.length, processingStoppedByTimeout: true });
      return { accessions, qrTokens, ignoredQrCount, decoded, attempts, failure: "barcode_processing_failed" };
    }
    let decodedPage: PageDecodeResult;
    if (pass === "original_sweep") {
      const decodedResult = await decodeBarcodeCandidates(page.pagePath, dependencies);
      attempts += 1; pagesExamined += 1;
      if (decodedResult.kind === "timeout" || decodedResult.kind === "failure") {
        const failure: PageFailure = decodedResult.kind === "timeout" ? "barcode_decoder_timeout" : "barcode_decoder_failed";
        log(dependencies, pageFailureCode(failure), { fileType: "pdf", pageNumber: page.pageNumber, dpi, currentPass: pass, pagesExamined, totalPageCount: pages.length });
        return { accessions, qrTokens, ignoredQrCount, decoded, attempts, failure };
      }
      const values = decodedResult.kind === "decoded" ? decodedBarcodeValues(decodedResult.output, allowedOrigins) : { decoded: false, accessions: [], qrTokens: [], ignoredQrCount: 0 };
      decoded ||= values.decoded; ignoredQrCount += values.ignoredQrCount;
      decodedPage = { ...values, attempts: 1, successfulAttempt: values.accessions.length || values.qrTokens.length ? "original" : null, rotation: values.accessions.length || values.qrTokens.length ? 0 : null };
    } else {
      decodedPage = await decodePageWithFallbacks(page.pagePath, tempDir, page.pageNumber, "pdf", dpi, dependencies, allowedOrigins, false);
      attempts += decodedPage.attempts; pagesExamined += 1; decoded ||= decodedPage.decoded; ignoredQrCount += decodedPage.ignoredQrCount;
      if (decodedPage.failure) {
        log(dependencies, pageFailureCode(decodedPage.failure), { fileType: "pdf", pageNumber: page.pageNumber, dpi, currentPass: pass, pagesExamined, totalPageCount: pages.length });
        return { accessions, qrTokens, ignoredQrCount, decoded, attempts, failure: decodedPage.failure };
      }
    }
    decodedPage.accessions.forEach((accession) => accessions.add(accession));
    decodedPage.qrTokens.forEach((token) => qrTokens.add(token));
    if (decodedPage.successfulAttempt) log(dependencies, dpi === 600 ? "BARCODE_SUCCESS_PDF_600_DPI" : decodedPage.successfulAttempt === "original" ? "BARCODE_SUCCESS_ORIGINAL" : decodedPage.successfulAttempt === "preprocessed" ? "BARCODE_SUCCESS_PREPROCESSED" : "BARCODE_SUCCESS_ROTATED", { fileType: "pdf", pageNumber: page.pageNumber, dpi, currentPass: pass, candidateSource: decodedPage.accessions.length && decodedPage.qrTokens.length ? "consensus" : decodedPage.accessions.length ? "accession" : "qr", attempt: decodedPage.successfulAttempt, rotation: decodedPage.rotation!, attemptCount: decodedPage.attempts, fallbackUsed: dpi === 600 });
  }
  return { accessions, qrTokens, ignoredQrCount, decoded, attempts };
}
async function scanPdfAtResolution(pdfPath: string, dpi: 300 | 600, rootTempDir: string, dependencies: RequestScanBarcodeDependencies, allowedOrigins: Set<string>, onProgress?: RequestScanQrOriginConfiguration["onProgress"]): Promise<ResolutionResult> {
  const stageDir = path.join(rootTempDir, `pdf-${dpi}`); await fs.mkdir(stageDir); const started = Date.now();
  const empty = (failure: RequestScanBarcodeFailure): ResolutionResult => ({ accessions: new Set(), qrTokens: new Set(), ignoredQrCount: 0, decoded: false, attempts: 0, failure });
  try {
    const prefix = path.join(stageDir, "page");
    await onProgress?.(dpi === 300 ? "rendering_300_dpi" : "rendering_600_dpi"); try { await dependencies.execFile("pdftoppm", ["-r", String(dpi), "-png", pdfPath, prefix], PDF_OPTIONS); } catch (error) {
      log(dependencies, "BARCODE_PDF_RENDER_FAILED", { fileType: "pdf", dpi, failureCategory: processTimedOut(error) ? "timeout" : "executable_failure", elapsedMs: Date.now() - started });
      return empty("pdf_render_failed");
    }
    const pages = orderedRenderedPages((await fs.readdir(stageDir)).filter((name) => /^page-\d+\.png$/i.test(name)).map((name) => path.join(stageDir, name)));
    if (!pages.length) {
      log(dependencies, "BARCODE_PDF_RENDER_FAILED", { fileType: "pdf", dpi, failureCategory: "no_pages", elapsedMs: Date.now() - started });
      return empty("pdf_render_failed");
    }
    log(dependencies, "BARCODE_PDF_SCAN_STARTED", { fileType: "pdf", dpi, totalPageCount: pages.length, pageScanOrder: pages.map((page) => page.pageNumber).join(","), currentPass: "original_sweep", processingStoppedByTimeout: false });
    const deadline = Date.now() + PDF_STAGE_TIMEOUT_MS;
    const original = await scanPdfPass(pages, stageDir, dpi, "original_sweep", deadline, dependencies, allowedOrigins, onProgress);
    if (original.failure || original.accessions.size || original.qrTokens.size) return original;
    const enhanced = await scanPdfPass(pages, stageDir, dpi, "enhanced_sweep", deadline, dependencies, allowedOrigins, onProgress);
    return { ...enhanced, ignoredQrCount: original.ignoredQrCount + enhanced.ignoredQrCount, decoded: original.decoded || enhanced.decoded, attempts: original.attempts + enhanced.attempts };
  } finally { await fs.rm(stageDir, { recursive: true, force: true }); }
}
function summarize(result: ResolutionResult): RequestScanBarcodeResult {
  if (result.failure) return { ok: false, reason: result.failure };
  if (result.accessions.size > 1) return { ok: false, reason: "multiple_accessions" };
  const accession = result.accessions.size === 1 ? [...result.accessions][0] : undefined;
  const qrTokens = [...result.qrTokens];
  if (accession || qrTokens.length) {
    return {
      ok: true,
      ...(accession ? { accession } : {}),
      ...(qrTokens.length ? { qrTokens } : {}),
      ...(result.ignoredQrCount ? { ignoredQrCount: result.ignoredQrCount } : {}),
    };
  }
  return {
    ok: false,
    reason: result.decoded ? "no_valid_accession" : "no_barcode",
    ...(result.ignoredQrCount ? { ignoredQrCount: result.ignoredQrCount } : {}),
  };
}
function terminalDiagnostic(result: RequestScanBarcodeResult): DiagnosticCode | null { return result.ok ? null : result.reason === "no_barcode" ? "BARCODE_NOT_DETECTED" : result.reason === "no_valid_accession" ? "BARCODE_DETECTED_INVALID_ACCESSION" : result.reason === "multiple_accessions" ? "BARCODE_MULTIPLE_VALID_ACCESSIONS" : result.reason === "pdf_render_failed" ? "BARCODE_PDF_RENDER_FAILED" : result.reason === "barcode_decoder_timeout" ? "BARCODE_DECODER_TIMEOUT" : result.reason === "barcode_decoder_failed" ? "BARCODE_DECODER_FAILED" : result.reason === "image_preprocess_failed" ? "BARCODE_PREPROCESSING_FAILED" : "BARCODE_PROCESSING_FAILED"; }
export async function extractRequestScanBarcode(filePath: string, dependencies: RequestScanBarcodeDependencies = defaultDependencies, qrOriginConfiguration: RequestScanQrOriginConfiguration = {}): Promise<RequestScanBarcodeResult> {
  const extension = path.extname(filePath).toLowerCase();
  if (![".pdf", ".jpg", ".jpeg"].includes(extension)) return { ok: false, reason: "unsupported_file" };
  const fileType: FileType = extension === ".pdf" ? "pdf" : "image"; const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-")); const started = Date.now();
  try {
    let result: RequestScanBarcodeResult; let attempts = 0; let fallbackUsed = false; let successfulDpi: 300 | 600 | "none" = "none";
    if (fileType === "pdf") {
      const allowedOrigins = trustedRequestScanQrOrigins(qrOriginConfiguration);
      const first = await scanPdfAtResolution(filePath, 300, tempDir, dependencies, allowedOrigins, qrOriginConfiguration.onProgress); attempts += first.attempts; result = summarize(first);
      if (!first.failure && (first.accessions.size || first.qrTokens.size)) successfulDpi = 300;
      if (!first.failure && first.accessions.size === 0 && first.qrTokens.size === 0) {
        fallbackUsed = true;
        const fallback = await scanPdfAtResolution(filePath, 600, tempDir, dependencies, allowedOrigins, qrOriginConfiguration.onProgress); attempts += fallback.attempts; result = summarize(fallback);
        if (!fallback.failure) {
          if (fallback.accessions.size || fallback.qrTokens.size) successfulDpi = 600;
          result = summarize({
            ...fallback,
            decoded: first.decoded || fallback.decoded,
            ignoredQrCount: first.ignoredQrCount + fallback.ignoredQrCount,
          });
        }
      }
    } else {
      const page = await decodePageWithFallbacks(filePath, tempDir, 1, "image", "source", dependencies, trustedRequestScanQrOrigins(qrOriginConfiguration)); attempts = page.attempts;
      result = page.failure ? { ok: false, reason: page.failure } : summarize({ accessions: new Set(page.accessions), qrTokens: new Set(page.qrTokens), ignoredQrCount: page.ignoredQrCount, decoded: page.decoded, attempts });
      if (page.successfulAttempt) log(dependencies, page.successfulAttempt === "original" ? "BARCODE_SUCCESS_ORIGINAL" : page.successfulAttempt === "preprocessed" ? "BARCODE_SUCCESS_PREPROCESSED" : "BARCODE_SUCCESS_ROTATED", { fileType, pageNumber: 1, dpi: "source", attempt: page.successfulAttempt, rotation: page.rotation!, attemptCount: attempts, fallbackUsed: false });
    }
    const terminal = terminalDiagnostic(result);
    if (terminal) log(dependencies, terminal, { fileType, attemptCount: attempts, elapsedMs: Date.now() - started, fallbackUsed, successfulDpi: "none" });
    dependencies.logDiagnostic?.("recognition_complete", { fileType, outcome: result.ok ? "success" : result.reason, attemptCount: attempts, elapsedMs: Date.now() - started, fallbackUsed, successfulDpi: result.ok && fileType === "pdf" ? successfulDpi : "none" });
    return result;
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}
