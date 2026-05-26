import crypto from "node:crypto";

const ENV_KDF = "scrypt";
const ENV_CIPHER = "aes-256-gcm";
const ENV_SALT_BYTES = 16;
const ENV_IV_BYTES = 12;
const ENV_KEY_BYTES = 32;

export interface BackupV3EnvPayload {
  createdAt: string;
  variables: Record<string, string>;
}

export interface BackupV3EncryptedEnvBundle {
  cipher: typeof ENV_CIPHER;
  kdf: typeof ENV_KDF;
  salt: string;
  iv: string;
  authTag: string;
  data: string;
  variableNames: string[];
}

function deriveEnvKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, ENV_KEY_BYTES);
}

export function encryptBackupV3EnvPayload(
  payload: BackupV3EnvPayload,
  passphrase: string,
  randomBytes: (size: number) => Buffer = crypto.randomBytes
): BackupV3EncryptedEnvBundle {
  const salt = randomBytes(ENV_SALT_BYTES);
  const iv = randomBytes(ENV_IV_BYTES);
  const key = deriveEnvKey(passphrase, salt);
  const cipher = crypto.createCipheriv(ENV_CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);

  return {
    cipher: ENV_CIPHER,
    kdf: ENV_KDF,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
    variableNames: Object.keys(payload.variables).sort(),
  };
}

export function decryptBackupV3EnvPayload(bundle: BackupV3EncryptedEnvBundle, passphrase: string): BackupV3EnvPayload {
  if (bundle.cipher !== ENV_CIPHER || bundle.kdf !== ENV_KDF) {
    throw new Error("Unsupported env encryption.");
  }
  const key = deriveEnvKey(passphrase, Buffer.from(bundle.salt, "base64"));
  const decipher = crypto.createDecipheriv(ENV_CIPHER, key, Buffer.from(bundle.iv, "base64"));
  decipher.setAuthTag(Buffer.from(bundle.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(bundle.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const payload = JSON.parse(decrypted) as BackupV3EnvPayload;
  if (!payload.variables || typeof payload.variables !== "object") {
    throw new Error("Invalid env payload.");
  }
  return payload;
}
