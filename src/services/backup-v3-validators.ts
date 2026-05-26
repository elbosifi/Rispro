import path from "node:path";
import { verifyBackupV3Checksum } from "./backup-v3-checksums.js";
import {
  BACKUP_V3_FORMAT_VERSION,
  type BackupV3ArchiveEntry,
  type BackupV3ArchiveLimits,
  type BackupV3CompatibilityIssue,
  type BackupV3CompatibilityResult,
  type BackupV3Manifest,
  type BackupV3RuntimeMetadata,
} from "./backup-v3-types.js";

const ALLOWED_PREFIXES = [
  "manifest.json",
  "database/",
  "config/",
  "storage/",
  "documents/",
] as const;

function isWindowsDrivePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function isUncPath(value: string): boolean {
  return value.startsWith("\\\\") || value.startsWith("//");
}

function normalizeArchivePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function hasAllowedPrefix(value: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => value === prefix.replace(/\/$/, "") || value.startsWith(prefix));
}

export function validateBackupV3ArchiveEntries(
  entries: BackupV3ArchiveEntry[],
  limits: BackupV3ArchiveLimits
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  let fileCount = 0;
  let totalUncompressedSize = 0;

  for (const entry of entries) {
    const archivePath = normalizeArchivePath(entry.path);
    if (!archivePath || archivePath !== entry.path && entry.path.includes("\\")) {
      errors.push(`Archive entry uses backslashes: ${entry.path}`);
    }
    if (path.posix.isAbsolute(archivePath) || isWindowsDrivePath(entry.path) || isUncPath(entry.path)) {
      errors.push(`Archive entry uses an absolute path: ${entry.path}`);
    }
    if (archivePath.split("/").includes("..")) {
      errors.push(`Archive entry contains path traversal: ${entry.path}`);
    }
    if (!hasAllowedPrefix(archivePath)) {
      errors.push(`Archive entry has unexpected prefix: ${entry.path}`);
    }
    if (["symlink", "hardlink", "device", "special"].includes(entry.type)) {
      errors.push(`Archive entry type is not allowed: ${entry.path}`);
    }
    if (seen.has(archivePath)) {
      errors.push(`Archive contains duplicate entry: ${entry.path}`);
    }
    seen.add(archivePath);

    if (entry.type === "file") {
      fileCount += 1;
      totalUncompressedSize += entry.uncompressedSize;
      if (entry.uncompressedSize > limits.maxFileBytes) {
        errors.push(`Archive entry exceeds max file size: ${entry.path}`);
      }
    }
  }

  if (fileCount > limits.maxFiles) {
    errors.push(`Archive contains too many files: ${fileCount}`);
  }
  if (totalUncompressedSize > limits.maxTotalUncompressedBytes) {
    errors.push(`Archive exceeds max total uncompressed size: ${totalUncompressedSize}`);
  }

  return errors;
}

export function validateBackupV3ManifestChecksums(
  manifest: BackupV3Manifest,
  actualFiles: Map<string, { sha256: string; byteSize: number }>
): string[] {
  const errors: string[] = [];
  for (const file of manifest.files) {
    const actual = actualFiles.get(file.archivePath);
    if (!actual) {
      errors.push(`Missing staged file: ${file.archivePath}`);
      continue;
    }
    if (!verifyBackupV3Checksum(actual, file)) {
      errors.push(`Checksum or size mismatch: ${file.archivePath}`);
    }
  }
  return errors;
}

export function validateBackupV3Compatibility(
  manifest: BackupV3Manifest,
  runtime: BackupV3RuntimeMetadata
): BackupV3CompatibilityResult {
  const issues: BackupV3CompatibilityIssue[] = [];

  if (manifest.formatVersion !== BACKUP_V3_FORMAT_VERSION) {
    issues.push({
      severity: "error",
      code: "unsupported_format_version",
      message: `Backup format version ${manifest.formatVersion} is not supported.`,
    });
  }

  if (manifest.app.name !== runtime.appName) {
    issues.push({
      severity: "error",
      code: "app_name_mismatch",
      message: `Backup app ${manifest.app.name} does not match ${runtime.appName}.`,
    });
  }

  if (manifest.app.packageVersion !== runtime.packageVersion) {
    issues.push({
      severity: "warning",
      code: "package_version_mismatch",
      message: "Backup package version differs from the running app.",
    });
  }

  if (manifest.app.gitCommit && runtime.gitCommit && manifest.app.gitCommit !== runtime.gitCommit) {
    issues.push({
      severity: "warning",
      code: "git_commit_mismatch",
      message: "Backup git commit differs from the running app.",
    });
  }

  if (manifest.database.migrationVersion !== runtime.database.migrationVersion) {
    issues.push({
      severity: "error",
      code: "migration_version_mismatch",
      message: "Backup migration version differs from the running database.",
    });
  }

  const runtimeTables = new Map(runtime.database.tables.map((table) => [`${table.schema}.${table.name}`, table]));
  for (const backupTable of manifest.database.tables) {
    const runtimeTable = runtimeTables.get(`${backupTable.schema}.${backupTable.name}`);
    if (!runtimeTable) {
      issues.push({
        severity: "error",
        code: "missing_runtime_table",
        message: `Running database is missing table ${backupTable.schema}.${backupTable.name}.`,
      });
      continue;
    }

    const runtimeColumns = new Map(runtimeTable.columns.map((column) => [column.name, column]));
    for (const backupColumn of backupTable.columns) {
      const runtimeColumn = runtimeColumns.get(backupColumn.name);
      if (!runtimeColumn) {
        issues.push({
          severity: "error",
          code: "missing_runtime_column",
          message: `Running database is missing column ${backupTable.schema}.${backupTable.name}.${backupColumn.name}.`,
        });
        continue;
      }
      if (
        runtimeColumn.dataType !== backupColumn.dataType ||
        runtimeColumn.udtName !== backupColumn.udtName ||
        runtimeColumn.isNullable !== backupColumn.isNullable
      ) {
        issues.push({
          severity: "error",
          code: "column_metadata_mismatch",
          message: `Column metadata differs for ${backupTable.schema}.${backupTable.name}.${backupColumn.name}.`,
        });
      }
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}
