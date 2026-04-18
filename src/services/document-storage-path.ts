import path from "path";
import { fileURLToPath } from "url";
import { HttpError } from "../utils/http-error.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

export function getProjectRootDir(): string {
  return rootDir;
}

export function isUncPath(input: string): boolean {
  return input.startsWith("\\\\") || input.startsWith("//");
}

function isWindowsDrivePath(input: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(input);
}

export function isAbsoluteStoragePath(input: string): boolean {
  return path.isAbsolute(input) || isWindowsDrivePath(input) || isUncPath(input);
}

export function resolveStoredPath(storedPath: unknown): string {
  const raw = String(storedPath || "").trim();
  if (!raw) {
    throw new HttpError(400, "Invalid document path.");
  }

  if (isAbsoluteStoragePath(raw)) {
    return path.normalize(raw);
  }

  const absolutePath = path.resolve(rootDir, raw);
  if (!absolutePath.startsWith(rootDir)) {
    throw new HttpError(400, "Invalid document path.");
  }

  return absolutePath;
}

export function toStoredPath(absolutePath: string): string {
  const normalized = path.normalize(absolutePath);
  if (normalized.startsWith(rootDir)) {
    return path.relative(rootDir, normalized);
  }
  return normalized;
}

export function resolveStorageBasePath(storagePath: string): string {
  const raw = String(storagePath || "").trim();
  if (!raw) {
    throw new HttpError(400, "Storage path is required.");
  }

  if (isAbsoluteStoragePath(raw)) {
    return path.normalize(raw);
  }

  const absolutePath = path.resolve(rootDir, raw);
  if (!absolutePath.startsWith(rootDir)) {
    throw new HttpError(400, "Invalid relative storage path.");
  }

  return absolutePath;
}
