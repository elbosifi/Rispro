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
  execFile(command: string, args: string[], options: { timeout: number; maxBuffer: number; signal?: AbortSignal }): Promise<{ stdout?: string; stderr?: string }>;
  imageProcessor?: { preprocess(sourcePath: string, destinationPath: string): Promise<void>; rotate(sourcePath: string, angle: 90 | 180 | 270, destinationPath: string): Promise<void> };
  logDiagnostic?: (event: string, metadata: Record<string, string | number | boolean>) => void;
  metrics?: RequestScanRecognitionMetrics;
  signal?: AbortSignal;
};
export type RequestScanRecognitionMetrics = {
  elapsedMs: number; sourceBytes: number; pdfPageCount: number; pdftoppmProcesses: number; pdfimagesListProcesses: number; pdfimagesExtractionProcesses: number; zbarProcesses: number;
  sharpMetadataReads: number; sharpPreprocessOperations: number; sharpResizeOperations: number; sharpCropOperations: number; sharpRotationOperations: number;
  renderedBytes: number; nativeExtractedBytes: number; derivativeBytes: number; maximumTemporaryBytes: number;
  originalPagesExamined: number; enhancedPagesExamined: number; nativeImagesExamined: number; nativeTilesExamined: number;
  rssBeforeBytes: number; rssAfterBytes: number; peakObservedRssBytes?: number;
};
export type RequestScanQrOriginConfiguration = {
  risproPublicBaseUrl?: string;
  publicAppBaseUrl?: string;
  explicitAllowedOrigins?: string;
  onProgress?: (stage: "rendering_300_dpi" | "scanning_original_300_dpi" | "extracting_native_pdf_image" | "scanning_native_pdf_image" | "scanning_qr_crops" | "scanning_enhanced_300_dpi" | "rendering_600_dpi" | "scanning_original_600_dpi" | "scanning_enhanced_600_dpi", current?: number, total?: number) => void | Promise<void>;
  onPerformanceMetrics?: (metrics: Record<string, string | number | boolean>) => void;
  signal?: AbortSignal;
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
async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(item);
    else if (entry.isFile()) total += await fs.stat(item).then((value) => value.size, () => 0);
  }
  return total;
}
async function observeTemporaryBytes(metrics: RequestScanRecognitionMetrics | undefined, root: string): Promise<number> {
  const bytes = await directoryBytes(root);
  if (metrics) metrics.maximumTemporaryBytes = Math.max(metrics.maximumTemporaryBytes, bytes);
  return bytes;
}
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
function isAbortError(error: unknown): boolean { return Boolean(error && typeof error === "object" && ((error as { name?: unknown }).name === "AbortError" || (error as { code?: unknown }).code === "ABORT_ERR")); }
function throwIfAborted(dependencies: RequestScanBarcodeDependencies): void { dependencies.signal?.throwIfAborted(); }
function zbarNoSymbol(error: unknown): boolean { if (!error || typeof error !== "object" || processTimedOut(error)) return false; const value = error as NodeJS.ErrnoException & { stdout?: unknown; stderr?: unknown }; return Number(value.code) === 4 || /no symbols? found/i.test(`${String(value.stdout || "")} ${String(value.stderr || "")} ${value.message || ""}`); }
async function decodeBarcodeCandidates(filePath: string, dependencies: RequestScanBarcodeDependencies): Promise<ZbarResult> { try { throwIfAborted(dependencies); const result = await dependencies.execFile("zbarimg", ["--quiet", "--set", "*.enable=0", "--set", "code39.enable=1", "--set", "code128.enable=1", "--set", "qrcode.enable=1", filePath], { ...ZBAR_OPTIONS, signal: dependencies.signal }); const output = String(result.stdout || ""); return output.trim() ? { kind: "decoded", output } : { kind: "no_symbol" }; } catch (error) { if (isAbortError(error)) throw error; return zbarNoSymbol(error) ? { kind: "no_symbol" } : processTimedOut(error) ? { kind: "timeout" } : { kind: "failure" }; } }
async function withImageProcessingTimeout(operation: Promise<void>): Promise<void> { let timeout: NodeJS.Timeout | undefined; try { await Promise.race([operation, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Barcode image processing timed out")), IMAGE_PROCESSING_TIMEOUT_MS); })]); } finally { if (timeout) clearTimeout(timeout); } }
async function decodePageWithFallbacks(pagePath: string, tempDir: string, pageNumber: number, fileType: FileType, dpi: number | "source", dependencies: RequestScanBarcodeDependencies, allowedOrigins?: Set<string>, includeOriginal = true): Promise<PageDecodeResult> {
  throwIfAborted(dependencies);
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
  try { throwIfAborted(dependencies); await withImageProcessingTimeout(processor.preprocess(pagePath, processedPath)); } catch (error) { if (isAbortError(error)) throw error; preprocessingFailed = true; log(dependencies, "BARCODE_PREPROCESSING_FAILED", { fileType, pageNumber, dpi, attempt: "preprocessed", rotation: 0 }); }
  if (!preprocessingFailed) {
    const processed = await attempt(processedPath);
    if ("failure" in processed) return collectedQrTokens.size ? current() : current(processed.failure);
    collect(processed, "preprocessed", 0);
    if (collectedAccessions.size) return current();
  }
  if (!preprocessingFailed) for (const angle of [90, 180, 270] as const) {
    throwIfAborted(dependencies);
    const rotatedPath = path.join(tempDir, `processed-${pageNumber}-rotated-${angle}.png`);
    try { await withImageProcessingTimeout(processor.rotate(processedPath, angle, rotatedPath)); } catch (error) { if (isAbortError(error)) throw error; preprocessingFailed = true; log(dependencies, "BARCODE_PREPROCESSING_FAILED", { fileType, pageNumber, dpi, attempt: "rotated", rotation: angle }); continue; }
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
    throwIfAborted(dependencies);
    await onProgress?.(pass === "original_sweep" ? (dpi === 300 ? "scanning_original_300_dpi" : "scanning_original_600_dpi") : (dpi === 300 ? "scanning_enhanced_300_dpi" : "scanning_enhanced_600_dpi"), pagesExamined, pages.length);
    if (Date.now() > deadline) {
      log(dependencies, "BARCODE_PROCESSING_FAILED", { fileType: "pdf", dpi, currentPass: pass, pagesExamined, totalPageCount: pages.length, processingStoppedByTimeout: true });
      return { accessions, qrTokens, ignoredQrCount, decoded, attempts, failure: "barcode_processing_failed" };
    }
    let decodedPage: PageDecodeResult;
    if (pass === "original_sweep") {
      const decodedResult = await decodeBarcodeCandidates(page.pagePath, dependencies);
      attempts += 1; pagesExamined += 1;
      if (dependencies.metrics) dependencies.metrics.originalPagesExamined += 1;
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
      if (dependencies.metrics) dependencies.metrics.enhancedPagesExamined += 1;
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
const NATIVE_FALLBACK_TIMEOUT_MS = 120_000;
const MAX_NATIVE_IMAGES_PER_PAGE = 2;
export const MAX_NATIVE_TILES = 16;
const NATIVE_MIN_DIMENSION = 120;
const NATIVE_MAX_DIMENSION = 2_800;
export type NativeTile = { left: number; top: number; width: number; height: number };
export function prioritizeNativeTiles(tiles: NativeTile[], imageWidth: number, imageHeight: number): NativeTile[] {
  const isLeft = (tile: NativeTile) => tile.left === 0;
  const isRight = (tile: NativeTile) => tile.left + tile.width === imageWidth;
  const isTop = (tile: NativeTile) => tile.top === 0;
  const isBottom = (tile: NativeTile) => tile.top + tile.height === imageHeight;
  const priority = (tile: NativeTile) => (isLeft(tile) || isRight(tile)) && (isTop(tile) || isBottom(tile)) ? 0 : isLeft(tile) || isRight(tile) || isTop(tile) || isBottom(tile) ? 1 : 2;
  return [...tiles].sort((left, right) => priority(left) - priority(right));
}
export function nativeTiles(width: number, height: number): NativeTile[] {
  const cropWidth = Math.min(width, Math.max(1, Math.round(width * 0.4))); const cropHeight = Math.min(height, Math.max(1, Math.round(height * 0.35)));
  const xs = [...new Set([0, Math.max(0, Math.round(width * 0.25)), Math.max(0, Math.round(width * 0.5)), Math.max(0, width - cropWidth)])];
  const ys = [...new Set([0, Math.max(0, Math.round(height * 0.25)), Math.max(0, Math.round(height * 0.5)), Math.max(0, height - cropHeight)])];
  const unique = xs.flatMap((left) => ys.map((top) => ({ left: Math.min(left, width - cropWidth), top: Math.min(top, height - cropHeight), width: cropWidth, height: cropHeight }))).filter((tile, index, tiles) => tiles.findIndex((other) => other.left === tile.left && other.top === tile.top) === index);
  // Keep all edge and corner coverage before any future bound can remove interiors.
  return prioritizeNativeTiles(unique, width, height).slice(0, MAX_NATIVE_TILES);
}
export type PdfNativeImageMetadata = { page: number; imageNumber: number; type: string; width: number; height: number; colorSpace?: string; components?: number; bitsPerComponent?: number; encoding?: string; objectId?: string };
export function parsePdfImagesList(output: string): PdfNativeImageMetadata[] {
  const rows: PdfNativeImageMetadata[] = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 9 || !/^\d+$/.test(columns[0]!) || !/^\d+$/.test(columns[1]!)) continue;
    const [page, imageNumber, width, height, components, bitsPerComponent] = [columns[0], columns[1], columns[3], columns[4], columns[6], columns[7]].map(Number);
    if (![page, imageNumber, width, height].every(Number.isInteger) || page < 1 || imageNumber < 0 || width < 1 || height < 1) continue;
    rows.push({ page, imageNumber, type: columns[2]!.toLowerCase(), width, height, colorSpace: columns[5], components: Number.isInteger(components) ? components : undefined, bitsPerComponent: Number.isInteger(bitsPerComponent) ? bitsPerComponent : undefined, encoding: columns[8], objectId: columns.length > 11 ? `${columns[10]} ${columns[11]}` : undefined });
  }
  return rows;
}
function extractedImageNumber(name: string): number | null {
  const match = name.match(/-(\d+)\.[^.]+$/);
  return match ? Number(match[1]) : null;
}
async function scanNativePdfImages(pdfPath: string, pages: RenderedPage[], rootTempDir: string, dependencies: RequestScanBarcodeDependencies, allowedOrigins: Set<string>, onProgress?: RequestScanQrOriginConfiguration["onProgress"]): Promise<ResolutionResult> {
  const accessions = new Set<string>(); const qrTokens = new Set<string>(); let ignoredQrCount = 0; let decoded = false; let attempts = 0; const deadline = Date.now() + NATIVE_FALLBACK_TIMEOUT_MS; const nativeDir = path.join(rootTempDir, "native-images"); await fs.mkdir(nativeDir);
  const collect = async (candidate: string) => { attempts += 1; const result = await decodeBarcodeCandidates(candidate, dependencies); if (result.kind !== "decoded") return; const values = decodedBarcodeValues(result.output, allowedOrigins); decoded ||= values.decoded; ignoredQrCount += values.ignoredQrCount; values.accessions.forEach((value) => accessions.add(value)); values.qrTokens.forEach((value) => qrTokens.add(value)); };
  try {
    let listing: PdfNativeImageMetadata[];
    try {
      throwIfAborted(dependencies);
      const listed = await dependencies.execFile("pdfimages", ["-list", pdfPath], { ...PDF_OPTIONS, signal: dependencies.signal });
      listing = parsePdfImagesList(String(listed.stdout || ""));
      if (!listing.length) return { accessions, qrTokens, ignoredQrCount, decoded, attempts };
      await dependencies.execFile("pdfimages", ["-j", pdfPath, path.join(nativeDir, "image")], { ...PDF_OPTIONS, signal: dependencies.signal });
      if (dependencies.metrics) dependencies.metrics.nativeExtractedBytes = await observeTemporaryBytes(dependencies.metrics, nativeDir);
    } catch (error) {
      if (isAbortError(error)) throw error;
      log(dependencies, "BARCODE_PROCESSING_FAILED", { fileType: "pdf", currentPass: "native_extraction_failed" });
      return { accessions, qrTokens, ignoredQrCount, decoded, attempts };
    }
    const extracted = new Map<number, string>();
    for (const name of await fs.readdir(nativeDir)) {
      const number = extractedImageNumber(name);
      if (number != null && !extracted.has(number)) extracted.set(number, path.join(nativeDir, name));
    }
    for (const [pageIndex, page] of pages.entries()) {
      if (Date.now() > deadline) { log(dependencies, "BARCODE_PROCESSING_FAILED", { fileType: "pdf", currentPass: "native_fallback", pagesExamined: pageIndex, totalPageCount: pages.length, processingStoppedByTimeout: true }); break; }
      await onProgress?.("extracting_native_pdf_image", pageIndex, pages.length);
      const pageDir = path.join(nativeDir, `page-${page.pageNumber}`); await fs.mkdir(pageDir);
      const ranked = listing.filter((item) => item.page === page.pageNumber && item.type === "image" && item.width >= NATIVE_MIN_DIMENSION && item.height >= NATIVE_MIN_DIMENSION).map((item) => ({ candidate: extracted.get(item.imageNumber), width: item.width, height: item.height, imageNumber: item.imageNumber })).filter((item): item is { candidate: string; width: number; height: number; imageNumber: number } => Boolean(item.candidate)).sort((a, b) => b.width * b.height - a.width * a.height || a.imageNumber - b.imageNumber).slice(0, MAX_NATIVE_IMAGES_PER_PAGE);
      for (const [rank, image] of ranked.entries()) {
        throwIfAborted(dependencies);
        if (dependencies.metrics) dependencies.metrics.nativeImagesExamined += 1;
        await onProgress?.("scanning_native_pdf_image", rank + 1, ranked.length); await collect(image.candidate); if (accessions.size || qrTokens.size) continue;
        let transformWidth = image.width; let transformHeight = image.height;
        try { throwIfAborted(dependencies); if (dependencies.metrics) dependencies.metrics.sharpMetadataReads += 1; const metadata = await sharp(image.candidate).metadata(); transformWidth = metadata.width ?? image.width; transformHeight = metadata.height ?? image.height; }
        catch { continue; }
        const full = path.join(pageDir, `upscaled-${rank}.png`); const scale = Math.min(6, NATIVE_MAX_DIMENSION / Math.max(transformWidth, transformHeight)); if (scale > 1.05) { if (dependencies.metrics) dependencies.metrics.sharpResizeOperations += 1; try { await sharp(image.candidate).resize(Math.round(transformWidth * scale), Math.round(transformHeight * scale), { kernel: sharp.kernel.lanczos3 }).png().toFile(full); if (dependencies.metrics) dependencies.metrics.derivativeBytes += await fs.stat(full).then((value) => value.size, () => 0); await observeTemporaryBytes(dependencies.metrics, rootTempDir); await collect(full); } finally { await fs.rm(full, { force: true }).catch(() => undefined); } } if (accessions.size || qrTokens.size) continue;
        const tiles = nativeTiles(transformWidth, transformHeight);
        for (const [tileIndex, tile] of tiles.entries()) {
          throwIfAborted(dependencies);
          if (Date.now() > deadline) break;
          if (dependencies.metrics) dependencies.metrics.nativeTilesExamined += 1;
          await onProgress?.("scanning_qr_crops", tileIndex + 1, tiles.length);
          const cropped = path.join(pageDir, `crop-${rank}-${tileIndex}.png`);
          const normalized = path.join(pageDir, `crop-normalized-${rank}-${tileIndex}.png`);
          try {
            const cropScale = Math.min(6, NATIVE_MAX_DIMENSION / Math.max(tile.width, tile.height));
            if (dependencies.metrics) { dependencies.metrics.sharpCropOperations += 1; dependencies.metrics.sharpResizeOperations += 1; }
            await sharp(image.candidate).extract(tile).resize(Math.round(tile.width * cropScale), Math.round(tile.height * cropScale), { kernel: sharp.kernel.lanczos3 }).png().toFile(cropped);
            await collect(cropped); if (accessions.size || qrTokens.size) break;
            if (dependencies.metrics) dependencies.metrics.sharpPreprocessOperations += 1;
            await sharp(cropped).grayscale().normalise().png().toFile(normalized);
            await collect(normalized); if (accessions.size || qrTokens.size) break;
            for (const angle of [90, 180, 270]) {
              throwIfAborted(dependencies);
              const rotated = path.join(pageDir, `crop-rotated-${rank}-${tileIndex}-${angle}.png`);
              try { if (dependencies.metrics) dependencies.metrics.sharpRotationOperations += 1; await sharp(normalized).rotate(angle).png().toFile(rotated); await collect(rotated); }
              finally { await fs.rm(rotated, { force: true }).catch(() => undefined); }
              if (accessions.size || qrTokens.size) break;
            }
          } finally { await Promise.all([fs.rm(cropped, { force: true }), fs.rm(normalized, { force: true })]).catch(() => undefined); }
          if (accessions.size || qrTokens.size) break;
        }
      }
      await fs.rm(pageDir, { recursive: true, force: true }).catch(() => undefined);
    }
    return { accessions, qrTokens, ignoredQrCount, decoded, attempts };
  } finally { await fs.rm(nativeDir, { recursive: true, force: true }); }
}
async function scanPdfAtResolution(pdfPath: string, dpi: 300 | 600, rootTempDir: string, dependencies: RequestScanBarcodeDependencies, allowedOrigins: Set<string>, onProgress?: RequestScanQrOriginConfiguration["onProgress"]): Promise<ResolutionResult> {
  const stageDir = path.join(rootTempDir, `pdf-${dpi}`); await fs.mkdir(stageDir); const started = Date.now();
  const empty = (failure: RequestScanBarcodeFailure): ResolutionResult => ({ accessions: new Set(), qrTokens: new Set(), ignoredQrCount: 0, decoded: false, attempts: 0, failure });
  try {
    const prefix = path.join(stageDir, "page");
    await onProgress?.(dpi === 300 ? "rendering_300_dpi" : "rendering_600_dpi"); try { throwIfAborted(dependencies); await dependencies.execFile("pdftoppm", ["-r", String(dpi), "-png", pdfPath, prefix], { ...PDF_OPTIONS, signal: dependencies.signal }); } catch (error) {
      if (isAbortError(error)) throw error;
      log(dependencies, "BARCODE_PDF_RENDER_FAILED", { fileType: "pdf", dpi, failureCategory: processTimedOut(error) ? "timeout" : "executable_failure", elapsedMs: Date.now() - started });
      return empty("pdf_render_failed");
    }
    const pages = orderedRenderedPages((await fs.readdir(stageDir)).filter((name) => /^page-\d+\.png$/i.test(name)).map((name) => path.join(stageDir, name)));
    if (dependencies.metrics) dependencies.metrics.pdfPageCount = Math.max(dependencies.metrics.pdfPageCount, pages.length);
    if (dependencies.metrics) dependencies.metrics.renderedBytes += await observeTemporaryBytes(dependencies.metrics, stageDir);
    if (!pages.length) {
      log(dependencies, "BARCODE_PDF_RENDER_FAILED", { fileType: "pdf", dpi, failureCategory: "no_pages", elapsedMs: Date.now() - started });
      return empty("pdf_render_failed");
    }
    log(dependencies, "BARCODE_PDF_SCAN_STARTED", { fileType: "pdf", dpi, totalPageCount: pages.length, pageScanOrder: pages.map((page) => page.pageNumber).join(","), currentPass: "original_sweep", processingStoppedByTimeout: false });
    const deadline = Date.now() + PDF_STAGE_TIMEOUT_MS;
    const original = await scanPdfPass(pages, stageDir, dpi, "original_sweep", deadline, dependencies, allowedOrigins, onProgress);
    if (original.failure || original.accessions.size || original.qrTokens.size) return original;
    if (dpi === 300) {
      const native = await scanNativePdfImages(pdfPath, pages, rootTempDir, dependencies, allowedOrigins, onProgress);
      if (native.accessions.size || native.qrTokens.size) return { ...native, ignoredQrCount: original.ignoredQrCount + native.ignoredQrCount, decoded: original.decoded || native.decoded, attempts: original.attempts + native.attempts };
    }
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
  const counters: RequestScanRecognitionMetrics = { elapsedMs: 0, sourceBytes: 0, pdfPageCount: 0, pdftoppmProcesses: 0, pdfimagesListProcesses: 0, pdfimagesExtractionProcesses: 0, zbarProcesses: 0, sharpMetadataReads: 0, sharpPreprocessOperations: 0, sharpResizeOperations: 0, sharpCropOperations: 0, sharpRotationOperations: 0, renderedBytes: 0, nativeExtractedBytes: 0, derivativeBytes: 0, maximumTemporaryBytes: 0, originalPagesExamined: 0, enhancedPagesExamined: 0, nativeImagesExamined: 0, nativeTilesExamined: 0, rssBeforeBytes: 0, rssAfterBytes: 0 };
  const measuredDependencies: RequestScanBarcodeDependencies = {
    ...dependencies,
    signal: qrOriginConfiguration.signal,
    async execFile(command, args, options) {
      if (command === "pdftoppm") counters.pdftoppmProcesses += 1;
      else if (command === "pdfimages") args[0] === "-list" ? counters.pdfimagesListProcesses += 1 : counters.pdfimagesExtractionProcesses += 1;
      else if (command === "zbarimg") counters.zbarProcesses += 1;
      return dependencies.execFile(command, args, options);
    },
    imageProcessor: {
      async preprocess(source, destination) { counters.sharpPreprocessOperations += 1; return (dependencies.imageProcessor ?? defaultImageProcessor).preprocess(source, destination); },
      async rotate(source, angle, destination) { counters.sharpRotationOperations += 1; return (dependencies.imageProcessor ?? defaultImageProcessor).rotate(source, angle, destination); },
    },
    metrics: counters,
  };
  const sourceBytes = await fs.stat(filePath).then((value) => value.size, () => 0);
  const rssBeforeBytes = process.memoryUsage().rss;
  counters.sourceBytes = sourceBytes; counters.rssBeforeBytes = rssBeforeBytes;
  const fileType: FileType = extension === ".pdf" ? "pdf" : "image"; const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-")); const started = Date.now();
  try {
    let result: RequestScanBarcodeResult; let attempts = 0; let fallbackUsed = false; let successfulDpi: 300 | 600 | "none" = "none";
    if (fileType === "pdf") {
      const allowedOrigins = trustedRequestScanQrOrigins(qrOriginConfiguration);
      const first = await scanPdfAtResolution(filePath, 300, tempDir, measuredDependencies, allowedOrigins, qrOriginConfiguration.onProgress); attempts += first.attempts; result = summarize(first);
      if (!first.failure && (first.accessions.size || first.qrTokens.size)) successfulDpi = 300;
      if (!first.failure && first.accessions.size === 0 && first.qrTokens.size === 0) {
        fallbackUsed = true;
        const fallback = await scanPdfAtResolution(filePath, 600, tempDir, measuredDependencies, allowedOrigins, qrOriginConfiguration.onProgress); attempts += fallback.attempts; result = summarize(fallback);
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
      const page = await decodePageWithFallbacks(filePath, tempDir, 1, "image", "source", measuredDependencies, trustedRequestScanQrOrigins(qrOriginConfiguration)); attempts = page.attempts;
      result = page.failure ? { ok: false, reason: page.failure } : summarize({ accessions: new Set(page.accessions), qrTokens: new Set(page.qrTokens), ignoredQrCount: page.ignoredQrCount, decoded: page.decoded, attempts });
      if (page.successfulAttempt) log(dependencies, page.successfulAttempt === "original" ? "BARCODE_SUCCESS_ORIGINAL" : page.successfulAttempt === "preprocessed" ? "BARCODE_SUCCESS_PREPROCESSED" : "BARCODE_SUCCESS_ROTATED", { fileType, pageNumber: 1, dpi: "source", attempt: page.successfulAttempt, rotation: page.rotation!, attemptCount: attempts, fallbackUsed: false });
    }
    const terminal = terminalDiagnostic(result);
    if (terminal) log(dependencies, terminal, { fileType, attemptCount: attempts, elapsedMs: Date.now() - started, fallbackUsed, successfulDpi: "none" });
    counters.elapsedMs = Date.now() - started; counters.rssAfterBytes = process.memoryUsage().rss; counters.peakObservedRssBytes = Math.max(counters.rssBeforeBytes, counters.rssAfterBytes);
    const metrics = { fileType, outcome: result.ok ? "success" : result.reason, attemptCount: attempts, fallbackUsed, successfulDpi: result.ok && fileType === "pdf" ? successfulDpi : "none", ...counters };
    dependencies.logDiagnostic?.("recognition_complete", metrics);
    qrOriginConfiguration.onPerformanceMetrics?.(metrics);
    return result;
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
}
