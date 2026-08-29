import assert from "node:assert/strict";
import test from "node:test";
import { getDatabaseBackupAccessConfig } from "./database-backup-access-config.js";

test("database backup access config is disabled by default and contains no credential", () => {
  const result = getDatabaseBackupAccessConfig({});
  assert.deepEqual(result, {
    enabled: false,
    bindIp: "",
    port: "5432",
    allowedHosts: [],
    readOnly: true,
    applyCommand: "./scripts/update-docker.sh",
  });
  assert.equal(Object.hasOwn(result, "password"), false);
});

test("database backup access config reports the internal deployment whitelist", () => {
  const result = getDatabaseBackupAccessConfig({
    RISPRO_DB_MODE: "internal",
    RISPRO_DB_BACKUP_ACCESS_ENABLED: "true",
    RISPRO_DB_BACKUP_BIND_IP: "192.9.101.252",
    RISPRO_DB_BACKUP_PORT: "5432",
    RISPRO_DB_BACKUP_ALLOWED_IPS: "192.9.101.162, 192.9.101.163/32",
    DB_PASSWORD: "must-not-be-returned",
  });
  assert.deepEqual(result.allowedHosts, ["192.9.101.162", "192.9.101.163/32"]);
  assert.equal(result.enabled, true);
  assert.equal(JSON.stringify(result).includes("must-not-be-returned"), false);
});

test("external database mode never reports internal backup access as enabled", () => {
  const result = getDatabaseBackupAccessConfig({
    RISPRO_DB_MODE: "external",
    RISPRO_DB_BACKUP_ACCESS_ENABLED: "true",
  });
  assert.equal(result.enabled, false);
});
