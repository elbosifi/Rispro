import type {
  BackupV3ArchiveLimits,
  BackupV3ArchiveManifestEntry,
  BackupV3FileManifestEntry,
  BackupV3Manifest,
  BackupV3SchemaMetadata,
  BackupV3StorageRoot,
} from "./backup-v3-types.js";
import { BACKUP_V3_FORMAT_VERSION } from "./backup-v3-types.js";

export const DEFAULT_BACKUP_V3_ARCHIVE_LIMITS: BackupV3ArchiveLimits = {
  maxFiles: 60_000,
  maxFileBytes: 3 * 1024 * 1024 * 1024,
  maxTotalUncompressedBytes: 3 * 1024 * 1024 * 1024,
};

export interface BuildBackupV3ManifestInput {
  appName: string;
  packageVersion: string | null;
  gitCommit: string | null;
  createdAt: string;
  initiatedByUserId: string | number | null;
  database: BackupV3SchemaMetadata;
  storageRoots: BackupV3StorageRoot[];
  archiveEntries?: BackupV3ArchiveManifestEntry[];
  files: BackupV3FileManifestEntry[];
  envVariableNames: string[];
  limits?: Partial<BackupV3ArchiveLimits>;
}

export function buildBackupV3Manifest(input: BuildBackupV3ManifestInput): BackupV3Manifest {
  return {
    formatVersion: BACKUP_V3_FORMAT_VERSION,
    app: {
      name: input.appName,
      packageVersion: input.packageVersion,
      gitCommit: input.gitCommit,
    },
    createdAt: input.createdAt,
    initiatedByUserId: input.initiatedByUserId,
    database: input.database,
    storageRoots: [...input.storageRoots].sort((a, b) => a.id.localeCompare(b.id)),
    archiveEntries: [...(input.archiveEntries || [])].sort((a, b) => a.archivePath.localeCompare(b.archivePath)),
    files: [...input.files]
      .map((file) => ({
        archivePath: file.archivePath,
        rootId: file.rootId,
        relativePath: file.relativePath,
        byteSize: file.byteSize,
        sha256: file.sha256,
        crc32: file.crc32,
      }))
      .sort((a, b) => a.archivePath.localeCompare(b.archivePath)),
    env: {
      archivePath: "config/env.enc.json",
      variableNames: [...input.envVariableNames].sort(),
    },
    safetyBackup: {
      preferredMethod: "pg_dump_custom",
      fallbackMethod: "v3_snapshot",
    },
    limits: {
      ...DEFAULT_BACKUP_V3_ARCHIVE_LIMITS,
      ...input.limits,
    },
  };
}
