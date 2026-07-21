import type { BackupV3Manifest } from "./backup-v3-types.js";

export type BackupV3HistoricalCompatibility = "same_version" | "older_supported" | "newer_than_runtime" | "unsupported_history";

export function classifyBackupV3MigrationHistory(manifest: BackupV3Manifest, currentHistory: string[]): { classification: BackupV3HistoricalCompatibility; message: string } {
  const history = manifest.database.migrationHistory;
  if (!history?.length || new Set(history).size !== history.length) return { classification: "unsupported_history", message: "Backup does not contain a usable complete migration history." };
  if (history.some((name, index) => currentHistory[index] !== name)) {
    const known = history.every((name) => currentHistory.includes(name));
    return { classification: known ? "unsupported_history" : "newer_than_runtime", message: known ? "Backup migration history is reordered or not a prefix of this runtime." : "Backup contains migrations unavailable to this runtime." };
  }
  if (history.length === currentHistory.length) return { classification: "same_version", message: "Backup migration history matches this release." };
  if (!manifest.postgresDump) return { classification: "unsupported_history", message: "Older backup has no PostgreSQL custom dump for isolated migration rehearsal." };
  return { classification: "older_supported", message: "Backup is an ordered historical prefix and requires isolated migration rehearsal." };
}
