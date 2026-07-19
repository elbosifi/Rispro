import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { sha256Buffer } from "./backup-v3-checksums.js";
import { buildBackupV3Manifest } from "./backup-v3-manifest.js";
import { resolveBackupV3StorageRoots } from "./backup-v3-storage-roots.js";
import {
  validateBackupV3ArchiveEntries,
  validateBackupV3Compatibility,
  validateBackupV3ManifestChecksums,
} from "./backup-v3-validators.js";
import type { BackupV3SchemaMetadata, BackupV3TableMetadata } from "./backup-v3-types.js";

const usersTable: BackupV3TableMetadata = {
  schema: "public",
  name: "users",
  archivePath: "database/tables/public.users.json",
  rowCount: 2,
  columns: [
    {
      name: "id",
      dataType: "bigint",
      udtName: "int8",
      isNullable: false,
      hasDefault: true,
      ordinalPosition: 1,
    },
    {
      name: "username",
      dataType: "text",
      udtName: "text",
      isNullable: false,
      hasDefault: false,
      ordinalPosition: 2,
    },
  ],
};

const schemaMetadata: BackupV3SchemaMetadata = {
  schemas: ["public", "appointments_v2"],
  migrationVersion: "085_orthanc_mwl_queue_gate",
  tables: [usersTable],
};

test("buildBackupV3Manifest records v3 metadata and one JSON file per table", () => {
  const digest = sha256Buffer(Buffer.from("hello"));
  const manifest = buildBackupV3Manifest({
    appName: "rispro-reception",
    packageVersion: "0.1.0",
    gitCommit: "01de0b42",
    createdAt: "2026-05-26T00:00:00.000Z",
    initiatedByUserId: 7,
    database: schemaMetadata,
    storageRoots: [
      {
        id: "project-storage",
        kind: "project_storage",
        absolutePath: "C:\\rispro\\storage",
        archivePrefix: "storage/project",
        appOwned: true,
      },
    ],
    files: [
      {
        archivePath: "storage/project/example.txt",
        rootId: "project-storage",
        relativePath: "example.txt",
        byteSize: 5,
        sha256: digest,
      },
    ],
    envVariableNames: ["JWT_SECRET", "DATABASE_URL"],
  });

  assert.equal(manifest.formatVersion, 3);
  assert.equal(manifest.database.tables[0]?.archivePath, "database/tables/public.users.json");
  assert.deepEqual(manifest.env.variableNames, ["DATABASE_URL", "JWT_SECRET"]);
  assert.equal(manifest.safetyBackup.preferredMethod, "pg_dump_custom");
  assert.equal(manifest.safetyBackup.fallbackMethod, "v3_snapshot");
  assert.equal(manifest.files[0]?.sha256, digest);
});

test("resolveBackupV3StorageRoots includes app-owned roots and excludes unapproved external paths", () => {
  const roots = resolveBackupV3StorageRoots({
    uploadsDir: "storage/uploads",
    dicomWorklistSourceDir: "storage/dicom/worklist-source",
    dicomWorklistOutputDir: "storage/dicom/worklists",
    santeHl7OutputFolderPath: "storage/sante-hl7-outbox",
    documentStorageRoot: path.join(path.parse(process.cwd()).root, "external-documents"),
  });

  assert.ok(roots.some((root) => root.id === "project-storage"));
  assert.ok(roots.some((root) => root.id === "uploads"));
  assert.ok(roots.some((root) => root.id === "dicom-worklist-source"));
  assert.ok(roots.some((root) => root.id === "dicom-worklists"));
  assert.ok(roots.some((root) => root.id === "sante-hl7-outbox"));
  assert.ok(!roots.some((root) => root.id === "document-storage"));
});

test("resolveBackupV3StorageRoots permits explicitly allowlisted external document roots", () => {
  const externalRoot = path.join(path.parse(process.cwd()).root, "rispro-documents");
  const roots = resolveBackupV3StorageRoots({
    documentStorageRoot: externalRoot,
    documentStorageAllowlist: [externalRoot],
  });

  const documentRoot = roots.find((root) => root.id === "document-storage");
  assert.equal(documentRoot?.kind, "document_storage");
  assert.equal(documentRoot?.archivePrefix, "documents/external");
});

test("validateBackupV3ArchiveEntries rejects hostile archive entries", () => {
  const errors = validateBackupV3ArchiveEntries(
    [
      { path: "../escape.txt", type: "file", uncompressedSize: 1 },
      { path: "/absolute.txt", type: "file", uncompressedSize: 1 },
      { path: "C:\\temp\\file.txt", type: "file", uncompressedSize: 1 },
      { path: "\\\\server\\share\\file.txt", type: "file", uncompressedSize: 1 },
      { path: "storage/link", type: "symlink", uncompressedSize: 0 },
      { path: "storage/hard", type: "hardlink", uncompressedSize: 0 },
      { path: "storage/device", type: "device", uncompressedSize: 0 },
      { path: "unexpected/file.txt", type: "file", uncompressedSize: 1 },
      { path: "storage/project/a.txt", type: "file", uncompressedSize: 1 },
      { path: "storage/project/a.txt", type: "file", uncompressedSize: 1 },
      { path: "storage/project/large.bin", type: "file", uncompressedSize: 11 },
    ],
    { maxFiles: 7, maxFileBytes: 10, maxTotalUncompressedBytes: 20 }
  );

  assert.match(errors.join("\n"), /path traversal/);
  assert.match(errors.join("\n"), /absolute path/);
  assert.match(errors.join("\n"), /backslashes/);
  assert.match(errors.join("\n"), /not allowed/);
  assert.match(errors.join("\n"), /unexpected prefix/);
  assert.match(errors.join("\n"), /duplicate/);
  assert.match(errors.join("\n"), /max file size/);
  assert.match(errors.join("\n"), /too many files/);
});

test("validateBackupV3ArchiveEntries enforces total uncompressed size", () => {
  const errors = validateBackupV3ArchiveEntries(
    [
      { path: "storage/project/a.txt", type: "file", uncompressedSize: 8 },
      { path: "storage/project/b.txt", type: "file", uncompressedSize: 8 },
    ],
    { maxFiles: 10, maxFileBytes: 10, maxTotalUncompressedBytes: 12 }
  );

  assert.match(errors.join("\n"), /max total uncompressed size/);
});

test("validateBackupV3ManifestChecksums rejects missing and changed staged files", () => {
  const manifest = buildBackupV3Manifest({
    appName: "rispro-reception",
    packageVersion: "0.1.0",
    gitCommit: null,
    createdAt: "2026-05-26T00:00:00.000Z",
    initiatedByUserId: null,
    database: schemaMetadata,
    storageRoots: [],
    files: [
      {
        archivePath: "storage/project/ok.txt",
        rootId: "project-storage",
        relativePath: "ok.txt",
        byteSize: 2,
        sha256: sha256Buffer(Buffer.from("ok")),
      },
      {
        archivePath: "storage/project/missing.txt",
        rootId: "project-storage",
        relativePath: "missing.txt",
        byteSize: 7,
        sha256: sha256Buffer(Buffer.from("missing")),
      },
    ],
    envVariableNames: [],
  });

  const errors = validateBackupV3ManifestChecksums(
    manifest,
    new Map([["storage/project/ok.txt", { byteSize: 3, sha256: sha256Buffer(Buffer.from("bad")) }]])
  );

  assert.match(errors.join("\n"), /Checksum or size mismatch/);
  assert.match(errors.join("\n"), /Missing staged file/);
});

test("validateBackupV3Compatibility warns on version mismatch and rejects schema mismatch", () => {
  const manifest = buildBackupV3Manifest({
    appName: "rispro-reception",
    packageVersion: "0.1.0",
    gitCommit: "old",
    createdAt: "2026-05-26T00:00:00.000Z",
    initiatedByUserId: null,
    database: schemaMetadata,
    storageRoots: [],
    files: [],
    envVariableNames: [],
  });

  const result = validateBackupV3Compatibility(manifest, {
    appName: "rispro-reception",
    packageVersion: "0.2.0",
    gitCommit: "new",
    database: {
      ...schemaMetadata,
      migrationVersion: "084_worklist_compatibility_settings",
      tables: [
        {
          ...usersTable,
          columns: usersTable.columns.filter((column) => column.name !== "username"),
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "package_version_mismatch" && issue.severity === "warning"));
  assert.ok(result.issues.some((issue) => issue.code === "git_commit_mismatch" && issue.severity === "warning"));
  assert.ok(result.issues.some((issue) => issue.code === "migration_version_mismatch" && issue.severity === "error"));
  assert.ok(result.issues.some((issue) => issue.code === "missing_runtime_column" && issue.severity === "error"));
});

test("validateBackupV3Compatibility allows only the audited migration 128 to 129 restore pair", () => {
  const manifest = buildBackupV3Manifest({
    appName: "rispro-reception",
    packageVersion: "0.1.0",
    gitCommit: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    initiatedByUserId: null,
    database: { ...schemaMetadata, migrationVersion: "128_backup_v3_copy_only_retry.sql" },
    storageRoots: [],
    files: [],
    envVariableNames: [],
  });

  const compatible = validateBackupV3Compatibility(manifest, {
    appName: "rispro-reception",
    packageVersion: "0.1.0",
    gitCommit: null,
    database: { ...schemaMetadata, migrationVersion: "129_backup_v3_restore_cyclic_fk_deferral.sql" },
  });
  assert.equal(compatible.ok, true);
  assert.ok(compatible.issues.some((issue) => issue.code === "migration_version_compatible_upgrade" && issue.severity === "warning"));

  const unrelated = validateBackupV3Compatibility(manifest, {
    appName: "rispro-reception",
    packageVersion: "0.1.0",
    gitCommit: null,
    database: { ...schemaMetadata, migrationVersion: "130_unrelated_schema_change.sql" },
  });
  assert.equal(unrelated.ok, false);
  assert.ok(unrelated.issues.some((issue) => issue.code === "migration_version_mismatch" && issue.severity === "error"));
});
