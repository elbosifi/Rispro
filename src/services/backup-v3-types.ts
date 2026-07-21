export const BACKUP_V3_FORMAT_VERSION = 3;

export const BACKUP_V3_TABLE_SCHEMAS = ["public", "appointments_v2", "doctor_portal"] as const;

export const BACKUP_V3_EXCLUDED_TABLES = ["schema_migrations"] as const;

export type BackupV3StorageRootKind =
  | "project_storage"
  | "uploads"
  | "document_storage"
  | "dicom_worklist"
  | "hl7_outbox";

export type BackupV3SafetyBackupMethod = "pg_dump_custom" | "v3_snapshot";

export interface BackupV3SafetyBackupPlan {
  method: BackupV3SafetyBackupMethod;
  reason: string;
}

export interface BackupV3ColumnMetadata {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  hasDefault: boolean;
  ordinalPosition: number;
}

export interface BackupV3TableMetadata {
  schema: string;
  name: string;
  archivePath: string;
  rowCount: number;
  columns: BackupV3ColumnMetadata[];
}

export interface BackupV3SchemaMetadata {
  schemas: string[];
  migrationVersion: string | null;
  /** Complete ordered schema_migrations list; older V3 archives may omit it. */
  migrationHistory?: string[];
  postgres?: { serverMajor: number | null; pgDumpVersion: string | null; encoding: string | null; locale: string | null; collation: string | null; extensions: string[] };
  tables: BackupV3TableMetadata[];
}

export interface BackupV3StorageRoot {
  id: string;
  kind: BackupV3StorageRootKind;
  absolutePath: string;
  archivePrefix: string;
  appOwned: true;
}

export interface BackupV3FileManifestEntry {
  archivePath: string;
  rootId: string;
  relativePath: string;
  byteSize: number;
  sha256: string;
  crc32?: number;
}

export interface BackupV3ArchiveManifestEntry {
  archivePath: string;
  byteSize: number;
  sha256: string;
}

/** PostgreSQL custom-format dump bundled with automated Backup V3 archives. */
export interface BackupV3PostgresDumpManifestEntry extends BackupV3ArchiveManifestEntry {
  format: "custom";
}

export interface BackupV3ArchiveLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalUncompressedBytes: number;
}

export interface BackupV3Manifest {
  formatVersion: typeof BACKUP_V3_FORMAT_VERSION;
  app: {
    name: string;
    packageVersion: string | null;
    gitCommit: string | null;
  };
  createdAt: string;
  initiatedByUserId: string | number | null;
  database: BackupV3SchemaMetadata;
  storageRoots: BackupV3StorageRoot[];
  archiveEntries: BackupV3ArchiveManifestEntry[];
  /** Present for automated archives. Manual browser downloads remain compatible without it. */
  postgresDump?: BackupV3PostgresDumpManifestEntry;
  files: BackupV3FileManifestEntry[];
  env: {
    archivePath: "config/env.enc.json";
    variableNames: string[];
  };
  safetyBackup: {
    preferredMethod: "pg_dump_custom";
    fallbackMethod: "v3_snapshot";
  };
  limits: BackupV3ArchiveLimits;
}

export type BackupV3ArchiveEntryType =
  | "file"
  | "directory"
  | "symlink"
  | "hardlink"
  | "device"
  | "special";

export interface BackupV3ArchiveEntry {
  path: string;
  type: BackupV3ArchiveEntryType;
  uncompressedSize: number;
}

export interface BackupV3CompatibilityIssue {
  severity: "warning" | "error";
  code: string;
  message: string;
}

export interface BackupV3CompatibilityResult {
  ok: boolean;
  issues: BackupV3CompatibilityIssue[];
}

export interface BackupV3RuntimeMetadata {
  appName: string;
  packageVersion: string | null;
  gitCommit: string | null;
  database: BackupV3SchemaMetadata;
}
