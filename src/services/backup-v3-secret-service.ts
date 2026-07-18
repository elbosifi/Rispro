import crypto from "node:crypto";
import { HttpError } from "../utils/http-error.js";

const VERSION = "v1";

export function backupV3MasterKeyMaterial(source: string): Buffer {
  if (!source) {
    throw new HttpError(503, "Backup credential encryption is not configured. Set BACKUP_V3_MASTER_KEY before saving credentials.");
  }
  return crypto.createHash("sha256").update(source, "utf8").digest();
}

function masterKey(): Buffer { return backupV3MasterKeyMaterial(String(process.env.BACKUP_V3_MASTER_KEY || "")); }

export function validateBackupV3RecoveryKey(value: string): string {
  const normalized = value.trim().replace(/^BACKUP_V3_MASTER_KEY=/, "");
  if (!/^[A-Za-z0-9_-]{42,44}$/.test(normalized) || Buffer.from(normalized, "base64url").byteLength !== 32) {
    throw new HttpError(400, "The installation credential-encryption key recovery value is invalid.");
  }
  return normalized;
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
  return decryptBackupV3SecretWithKey(payload, String(process.env.BACKUP_V3_MASTER_KEY || ""));
}

/** Validates a recovery key without changing process configuration. */
export function decryptBackupV3SecretWithKey(payload: string, key: string): string {
  const [version, ivText, tagText, ciphertextText, ...extra] = payload.split(":");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra.length) {
    throw new HttpError(500, "Stored backup credentials are invalid.");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", backupV3MasterKeyMaterial(key), Buffer.from(ivText, "base64"));
    decipher.setAuthTag(Buffer.from(tagText, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new HttpError(503, "Stored backup credentials cannot be decrypted with the configured master key.");
  }
}

export function backupV3MaskedSecret(value: string | null | undefined): string | null {
  return value ? "********" : null;
}
