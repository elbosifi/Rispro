import crypto from "crypto";

export type RuntimeSecretBundle = { v: 1; alg: "aes-256-gcm"; iv: string; tag: string; ciphertext: string };

function key(): Buffer {
  const raw = String(process.env.RISPRO_SECRET_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new Error("RISPRO_SECRET_ENCRYPTION_KEY is not configured.");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) throw new Error("RISPRO_SECRET_ENCRYPTION_KEY must be base64 encoded 32 random bytes.");
  return decoded;
}
export function isRuntimeSecretEncryptionConfigured(): boolean { try { key(); return true; } catch { return false; } }
export function encryptRuntimeSecret(value: string): RuntimeSecretBundle {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { v: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}
export function decryptRuntimeSecret(bundle: RuntimeSecretBundle): string {
  if (!bundle || bundle.v !== 1 || bundle.alg !== "aes-256-gcm") throw new Error("Stored runtime secret format is unsupported.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(bundle.iv, "base64"));
  decipher.setAuthTag(Buffer.from(bundle.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
