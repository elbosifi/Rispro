import * as dicomParser from "dicom-parser";

const INITIAL_SCAN_BYTES = 128 * 1024;
const RETRY_SCAN_BYTES = 2 * 1024 * 1024;
const DEFAULT_BATCH_SIZE = 20;
export const DICOM_PREVIEW_HEADER_BYTES = INITIAL_SCAN_BYTES;
const MAX_PREVIEW_SAMPLE_FILES = 16;

const SKIPPABLE_FILE_NAMES = new Set([
  "DICOMDIR",
  "AUTORUN.INF",
]);

const SKIPPABLE_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "ini",
  "html",
  "htm",
  "xml",
  "log",
  "txt",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "ico",
  "pdf",
  "db",
  "pro",
]);

export interface DicomScanFileEntry {
  file: File;
  previewIndex?: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  studyDate: string;
  studyDescription: string;
  modality: string;
  patientId: string;
  patientName: string;
}

export interface DicomScanStudySummary {
  studyInstanceUid: string;
  studyDate: string;
  studyDescription: string;
  modality: string;
  patientId: string;
  patientName: string;
  seriesCount: number;
  fileCount: number;
  totalBytes: number;
  files: DicomScanFileEntry[];
}

export interface DicomScanUnparsedEntry {
  file: File;
  fileName: string;
  filePath: string;
  fileSize: number;
  reason: string;
}

export interface DicomStudyScanResult {
  studies: DicomScanStudySummary[];
  skippedSidecarCount: number;
  unparsedCount: number;
  totalFileCount: number;
  dicomLikeFileCount: number;
  parsedDicomFileCount: number;
  fallbackUploadFiles: File[];
  unparsedFiles: DicomScanUnparsedEntry[];
  previewOnly?: boolean;
  maxHeaderBytes?: number;
}

export interface DicomUploadSelectionPlan {
  files: File[];
  selectedStudyInstanceUid: string | null;
  usesFallback: boolean;
}

function sanitizeFileName(fileName: string): string {
  return String(fileName || "").split(/[\\/]/).pop()?.trim() || "dicom.dcm";
}

function fileExtension(fileName: string): string {
  const normalized = sanitizeFileName(fileName).toLowerCase();
  const parts = normalized.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function isSkippableDicomSidecarFile(fileName: string): boolean {
  const normalizedName = sanitizeFileName(fileName).toUpperCase();
  if (SKIPPABLE_FILE_NAMES.has(normalizedName)) {
    return true;
  }
  const ext = fileExtension(normalizedName);
  return SKIPPABLE_EXTENSIONS.has(ext.toLowerCase());
}

export function isLikelyDicomCandidate(file: File): boolean {
  const fileName = sanitizeFileName(file.name);
  if (isSkippableDicomSidecarFile(fileName)) {
    return false;
  }

  const mimeType = String(file.type || "").toLowerCase();
  const ext = fileExtension(fileName);
  if (ext === "dcm" || ext === "dicom" || ext === "ima") {
    return true;
  }
  if (mimeType.includes("dicom")) {
    return true;
  }
  if (mimeType === "" || mimeType === "application/octet-stream") {
    return true;
  }
  return false;
}

function normalizeTag(value: string | undefined): string {
  return String(value || "").trim();
}

function pickStudyDisplayValue(existing: string, next: string): string {
  if (!existing && next) return next;
  return existing;
}

function getFilePath(file: File): string {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return String(withRelativePath.webkitRelativePath || file.name || "").trim() || sanitizeFileName(file.name);
}

function selectPreviewSampleFiles(candidateFiles: File[], maxFiles = MAX_PREVIEW_SAMPLE_FILES): File[] {
  if (candidateFiles.length <= maxFiles) return candidateFiles;
  const selectedIndexes = new Set<number>();
  const leadingCount = Math.min(24, maxFiles);
  for (let index = 0; index < leadingCount; index += 1) {
    selectedIndexes.add(index);
  }
  const remainingSlots = maxFiles - selectedIndexes.size;
  for (let slot = 0; slot < remainingSlots; slot += 1) {
    const index = Math.floor((slot * (candidateFiles.length - 1)) / Math.max(1, remainingSlots - 1));
    selectedIndexes.add(index);
  }
  return Array.from(selectedIndexes)
    .sort((a, b) => a - b)
    .slice(0, maxFiles)
    .map((index) => candidateFiles[index]!)
    .filter(Boolean);
}

function rehydratePreviewResult(result: DicomStudyScanResult, sampledFiles: File[]): DicomStudyScanResult {
  const fileByPreviewIndex = new Map<number, File>();
  sampledFiles.forEach((file, previewIndex) => fileByPreviewIndex.set(previewIndex, file));

  const studies = (result.studies || []).map((study) => ({
    ...study,
    files: (study.files || []).map((entry) => ({
      ...entry,
      file: fileByPreviewIndex.get(Number(entry.previewIndex)) || sampledFiles[0] || new File([], entry.fileName || "dicom.dcm"),
    })),
  }));

  return {
    ...result,
    studies,
    fallbackUploadFiles: sampledFiles,
    previewOnly: true,
  };
}

export async function previewDicomStudiesFromFiles(files: File[]): Promise<DicomStudyScanResult> {
  const allFiles = Array.isArray(files) ? files : [];
  const candidateFiles = allFiles.filter(isLikelyDicomCandidate);
  const sampledFiles = selectPreviewSampleFiles(candidateFiles);
  if (sampledFiles.length === 0) {
    throw new Error("No DICOM-like files were found for preview.");
  }

  const formData = new FormData();
  formData.append("fileMetadata", JSON.stringify(sampledFiles.map((file) => ({
    fileName: sanitizeFileName(file.name),
    filePath: getFilePath(file),
    fileSize: Number(file.size || 0),
  }))));

  sampledFiles.forEach((file) => {
    formData.append("files", file.slice(0, DICOM_PREVIEW_HEADER_BYTES), file.name);
  });

  const response = await fetch("/api/pacs/remap/preview-multipart", {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(response.statusText || "DICOM preview failed.");
  }

  const result = await response.json() as DicomStudyScanResult;
  if ((result.studies || []).length === 0) {
    throw new Error("DICOM preview did not find a study.");
  }

  return rehydratePreviewResult(result, sampledFiles);
}

export function buildSkipPreviewScanResult(files: File[]): DicomStudyScanResult {
  const allFiles = Array.isArray(files) ? files : [];
  const fallbackUploadFiles = allFiles.filter(isLikelyDicomCandidate);
  const skippedSidecarCount = allFiles.filter((file) => isSkippableDicomSidecarFile(file.name)).length;

  return {
    studies: [],
    skippedSidecarCount,
    unparsedCount: 0,
    totalFileCount: allFiles.length,
    dicomLikeFileCount: fallbackUploadFiles.length,
    parsedDicomFileCount: 0,
    fallbackUploadFiles,
    unparsedFiles: [],
  };
}

async function parseDicomHeader(file: File): Promise<DicomScanFileEntry | null> {
  const chunks = [INITIAL_SCAN_BYTES, RETRY_SCAN_BYTES];
  for (const chunkSize of chunks) {
    const byteLength = Math.min(chunkSize, file.size || chunkSize);
    const blob = file.slice(0, byteLength);
    const buffer = await blob.arrayBuffer();
    const byteArray = new Uint8Array(buffer);

    try {
      const dataSet = dicomParser.parseDicom(byteArray, {
        untilTag: "x7fe00010",
      });

      const studyInstanceUid = normalizeTag(dataSet.string("x0020000d"));
      if (!studyInstanceUid) {
        return null;
      }

      return {
        file,
        fileName: sanitizeFileName(file.name),
        filePath: getFilePath(file),
        fileSize: Number(file.size || 0),
        studyInstanceUid,
        seriesInstanceUid: normalizeTag(dataSet.string("x0020000e")),
        sopInstanceUid: normalizeTag(dataSet.string("x00080018")),
        studyDate: normalizeTag(dataSet.string("x00080020")),
        studyDescription: normalizeTag(dataSet.string("x00081030")),
        modality: normalizeTag(dataSet.string("x00080060")),
        patientId: normalizeTag(dataSet.string("x00100020")),
        patientName: normalizeTag(dataSet.string("x00100010")),
      };
    } catch {
      // try a larger header slice on next iteration
    }
  }

  return null;
}

function summarizeStudies(entries: DicomScanFileEntry[]): DicomScanStudySummary[] {
  const map = new Map<string, DicomScanStudySummary & { seriesSet: Set<string> }>();
  for (const entry of entries) {
    const existing = map.get(entry.studyInstanceUid);
    if (!existing) {
      const seriesSet = new Set<string>();
      if (entry.seriesInstanceUid) seriesSet.add(entry.seriesInstanceUid);
      map.set(entry.studyInstanceUid, {
        studyInstanceUid: entry.studyInstanceUid,
        studyDate: entry.studyDate,
        studyDescription: entry.studyDescription,
        modality: entry.modality,
        patientId: entry.patientId,
        patientName: entry.patientName,
        seriesCount: 0,
        fileCount: 1,
        totalBytes: entry.fileSize,
        files: [entry],
        seriesSet,
      });
      continue;
    }

    existing.studyDate = pickStudyDisplayValue(existing.studyDate, entry.studyDate);
    existing.studyDescription = pickStudyDisplayValue(existing.studyDescription, entry.studyDescription);
    existing.modality = pickStudyDisplayValue(existing.modality, entry.modality);
    existing.patientId = pickStudyDisplayValue(existing.patientId, entry.patientId);
    existing.patientName = pickStudyDisplayValue(existing.patientName, entry.patientName);
    existing.fileCount += 1;
    existing.totalBytes += entry.fileSize;
    existing.files.push(entry);
    if (entry.seriesInstanceUid) existing.seriesSet.add(entry.seriesInstanceUid);
  }

  return Array.from(map.values()).map((value) => ({
    studyInstanceUid: value.studyInstanceUid,
    studyDate: value.studyDate,
    studyDescription: value.studyDescription,
    modality: value.modality,
    patientId: value.patientId,
    patientName: value.patientName,
    seriesCount: value.seriesSet.size || 1,
    fileCount: value.fileCount,
    totalBytes: value.totalBytes,
    files: value.files,
  }));
}

export async function scanDicomStudiesFromFiles(
  files: File[],
  options: { batchSize?: number } = {}
): Promise<DicomStudyScanResult> {
  const allFiles = Array.isArray(files) ? files : [];
  const batchSize = Math.max(1, Number(options.batchSize || DEFAULT_BATCH_SIZE));

  const candidateFiles: File[] = [];
  let skippedSidecarCount = 0;

  for (const file of allFiles) {
    if (isSkippableDicomSidecarFile(file.name)) {
      skippedSidecarCount += 1;
      continue;
    }
    if (isLikelyDicomCandidate(file)) {
      candidateFiles.push(file);
    }
  }

  const parsedEntries: DicomScanFileEntry[] = [];
  const unparsedEntries: DicomScanUnparsedEntry[] = [];

  for (let index = 0; index < candidateFiles.length; index += batchSize) {
    const batch = candidateFiles.slice(index, index + batchSize);
    const parsedBatch = await Promise.all(batch.map(async (file) => {
      const parsed = await parseDicomHeader(file);
      if (parsed) return parsed;
      return {
        file,
        fileName: sanitizeFileName(file.name),
        filePath: getFilePath(file),
        fileSize: Number(file.size || 0),
        reason: "missing_or_unreadable_study_uid",
      } as DicomScanUnparsedEntry;
    }));

    for (const item of parsedBatch) {
      if ("studyInstanceUid" in item) {
        parsedEntries.push(item);
      } else {
        unparsedEntries.push(item);
      }
    }

    // Yield to the event loop for large folders.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  const studies = summarizeStudies(parsedEntries)
    .sort((a, b) => b.fileCount - a.fileCount || b.totalBytes - a.totalBytes);

  return {
    studies,
    skippedSidecarCount,
    unparsedCount: unparsedEntries.length,
    totalFileCount: allFiles.length,
    dicomLikeFileCount: candidateFiles.length,
    parsedDicomFileCount: parsedEntries.length,
    fallbackUploadFiles: candidateFiles,
    unparsedFiles: unparsedEntries,
  };
}

export function buildDicomUploadSelectionPlan(
  scanResult: DicomStudyScanResult | null,
  selectedStudyInstanceUid: string,
  fallbackEnabled: boolean
): DicomUploadSelectionPlan {
  const selectedUid = String(selectedStudyInstanceUid || "").trim();
  const selectedStudy = scanResult?.studies.find((study) => study.studyInstanceUid === selectedUid) || null;
  if (selectedStudy) {
    return {
      files: selectedStudy.files.map((entry) => entry.file),
      selectedStudyInstanceUid: selectedStudy.studyInstanceUid,
      usesFallback: false,
    };
  }

  if (fallbackEnabled) {
    return {
      files: scanResult?.fallbackUploadFiles || [],
      selectedStudyInstanceUid: null,
      usesFallback: true,
    };
  }

  return {
    files: [],
    selectedStudyInstanceUid: null,
    usesFallback: false,
  };
}
