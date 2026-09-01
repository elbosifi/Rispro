import assert from "node:assert/strict";
import test from "node:test";
import { decryptRuntimeSecret, encryptRuntimeSecret, isRuntimeSecretEncryptionConfigured } from "./runtime-secret-crypto.js";

const original=process.env.RISPRO_SECRET_ENCRYPTION_KEY;
test("runtime secret encryption uses a validated random AES-256-GCM envelope",()=>{const key=Buffer.alloc(32,7).toString("base64");process.env.RISPRO_SECRET_ENCRYPTION_KEY=key;assert.equal(isRuntimeSecretEncryptionConfigured(),true);const one=encryptRuntimeSecret("smtp-password");const two=encryptRuntimeSecret("smtp-password");assert.equal(decryptRuntimeSecret(one),"smtp-password");assert.notEqual(one.iv,two.iv);assert.notEqual(one.ciphertext,two.ciphertext);assert.equal(JSON.stringify(one).includes("smtp-password"),false);process.env.RISPRO_SECRET_ENCRYPTION_KEY=Buffer.alloc(32,8).toString("base64");assert.throws(()=>decryptRuntimeSecret(one));process.env.RISPRO_SECRET_ENCRYPTION_KEY="short";assert.equal(isRuntimeSecretEncryptionConfigured(),false);if(original===undefined)delete process.env.RISPRO_SECRET_ENCRYPTION_KEY;else process.env.RISPRO_SECRET_ENCRYPTION_KEY=original;});
