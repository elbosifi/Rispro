import crypto from "node:crypto";
import { HttpError } from "../utils/http-error.js";

const VERSION = "v1";

function masterKey(): Buffer {
  const source = String(process.env.BACKUP_V3_MASTER_KEY || "");
  if (!source) {
    throw new HttpError(503, "Backup credential encryption is not configured. Set BACKUP_V3_MASTER_KEY before saving credentials.");
  }
  return crypto.createHash("sha256").update(source, "utf8").digest();
}

/** Encrypts a secret for database storage; callers must never log the output. */
export function encryptBackupV3Secret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypts an encrypted secret or fails safely when the configured master key changed. */
export function decryptBackupV3Secret(payload: string): string {
  const [version, ivText, tagText, ciphertextText, ...extra] = payload.split(":");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra.length) {
    throw new HttpError(500, "Stored backup credentials are invalid.");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivText, "base64"));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new HttpError(503, "Stored backup credentials cannot be decrypted with the configured master key.");
  }
}

export function backupV3MaskedSecret(value: string | null | undefined): string | null {
  return value ? "********" : null;
}
