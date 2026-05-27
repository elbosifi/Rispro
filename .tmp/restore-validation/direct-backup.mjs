import { createWriteStream } from "node:fs";
import { streamBackupV3Archive } from "./src/services/backup-v3-service.js";
try {
  await streamBackupV3Archive({ currentUserId: 2, passphrase: "staging-restore-passphrase-CHANGE-ME", output: createWriteStream("/tmp/direct-backup.rispro.zip"), backupName: "direct.rispro.zip" });
  console.log("DIRECT_BACKUP_OK");
} catch (error) {
  console.error("DIRECT_BACKUP_ERROR", error);
  process.exit(1);
}
