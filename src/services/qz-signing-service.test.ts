import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { getQzCertificate, signQzRequest } from "./qz-signing-service.js";

const originalCertificate = process.env.QZ_CERTIFICATE;
const originalPrivateKey = process.env.QZ_PRIVATE_KEY;

afterEach(() => {
  if (originalCertificate === undefined) delete process.env.QZ_CERTIFICATE; else process.env.QZ_CERTIFICATE = originalCertificate;
  if (originalPrivateKey === undefined) delete process.env.QZ_PRIVATE_KEY; else process.env.QZ_PRIVATE_KEY = originalPrivateKey;
});

describe("QZ request signing", () => {
  it("returns the configured certificate and creates an RSA SHA-512 signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.QZ_CERTIFICATE = "test-certificate";
    process.env.QZ_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const request = '{"call":"printers.find","params":{},"timestamp":1}';
    const signature = signQzRequest(request);
    assert.equal(getQzCertificate(), "test-certificate");
    assert.equal(verify("RSA-SHA512", Buffer.from(request), publicKey, Buffer.from(signature, "base64")), true);
  });

  it("refuses to sign when no private key is configured", () => {
    delete process.env.QZ_PRIVATE_KEY;
    assert.throws(() => signQzRequest("request"), /QZ_PRIVATE_KEY is not configured/);
  });
});

