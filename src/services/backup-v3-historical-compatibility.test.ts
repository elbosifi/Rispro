import assert from "node:assert/strict";
import test from "node:test";
import { classifyBackupV3MigrationHistory } from "./backup-v3-historical-compatibility.js";

const runtime = ["001_initial.sql", "002_next.sql", "003_current.sql"];
function manifest(history?: string[], dump = true) { return { database: { migrationHistory: history }, ...(dump ? { postgresDump: { format: "custom" } } : {}) } as never; }

test("classifies identical complete migration history as same version", () => assert.equal(classifyBackupV3MigrationHistory(manifest(runtime), runtime).classification, "same_version"));
test("classifies a valid historical prefix as older supported", () => assert.equal(classifyBackupV3MigrationHistory(manifest(runtime.slice(0, 2)), runtime).classification, "older_supported"));
test("rejects newer, missing, unknown, and reordered migration histories", () => {
  assert.equal(classifyBackupV3MigrationHistory(manifest([...runtime, "004_future.sql"]), runtime).classification, "newer_than_runtime");
  assert.equal(classifyBackupV3MigrationHistory(manifest(), runtime).classification, "unsupported_history");
  assert.equal(classifyBackupV3MigrationHistory(manifest(["001_initial.sql", "999_unknown.sql"]), runtime).classification, "newer_than_runtime");
  assert.equal(classifyBackupV3MigrationHistory(manifest(["002_next.sql", "001_initial.sql"]), runtime).classification, "unsupported_history");
});
test("rejects older history without a PostgreSQL custom dump", () => assert.equal(classifyBackupV3MigrationHistory(manifest(runtime.slice(0, 2), false), runtime).classification, "unsupported_history"));
