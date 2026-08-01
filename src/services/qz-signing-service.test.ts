import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { env } from "../config/env.js";
import { getQzCertificate, signQzRequest, validateQzSigningRequest } from "./qz-signing-service.js";

const originalCertificate = process.env.QZ_CERTIFICATE;
const originalPrivateKey = process.env.QZ_PRIVATE_KEY;
const originalLimit = env.qzSigningRequestLimitMb;
let publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"];

beforeEach(() => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKey = keys.publicKey;
  process.env.QZ_CERTIFICATE = "test-certificate";
  process.env.QZ_PRIVATE_KEY = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  env.qzSigningRequestLimitMb = 25;
});
afterEach(() => {
  if (originalCertificate === undefined) delete process.env.QZ_CERTIFICATE; else process.env.QZ_CERTIFICATE = originalCertificate;
  if (originalPrivateKey === undefined) delete process.env.QZ_PRIVATE_KEY; else process.env.QZ_PRIVATE_KEY = originalPrivateKey;
  env.qzSigningRequestLimitMb = originalLimit;
});

function signed(payload: object): string {
  const request = JSON.stringify(payload);
  const digest = createHash("sha256").update(request).digest("hex");
  const signature = signQzRequest(request, digest);
  assert.equal(verify("RSA-SHA512", Buffer.from(digest), publicKey, Buffer.from(signature, "base64")), true);
  return signature;
}

describe("QZ request signing", () => {
  it("signs the exact QZ 2.2.6 discovery and details calls", () => {
    assert.equal(getQzCertificate(), "test-certificate");
    assert.ok(signed({ call: "printers.find", params: {}, timestamp: Date.now() }));
    assert.ok(signed({ call: "printers.detail", timestamp: Date.now() }));
  });
  it("signs pixel PDF print calls and verifies RSA SHA-512", () => {
    assert.ok(signed({ call: "print", params: { printer: { name: "RISPRO A4" }, options: {}, data: [{ type: "pixel", format: "pdf", flavor: "base64", data: "JVBERi0=" }] }, timestamp: Date.now() }));
  });
  it("rejects unknown, file, socket, USB, HID, and raw print calls", () => {
    for (const call of ["unknown.call", "file.read", "socket.sendData", "usb.listDevices", "hid.listDevices"]) assert.throws(() => validateQzSigningRequest(JSON.stringify({ call, params: {}, timestamp: Date.now() })), /not approved/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "print", params: { printer: { name: "P" }, options: {}, data: [{ type: "raw", format: "command", flavor: "plain", data: "danger" }] }, timestamp: Date.now() })), /pixel PDF or HTML/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "print", params: { printer: { name: "P" }, options: { forceRaw: true }, data: [{ type: "pixel", format: "pdf", flavor: "base64", data: "JVBERi0=" }] }, timestamp: Date.now() })), /driver bypass/);
  });
  it("rejects malformed JSON and missing or invalid timestamps", () => {
    assert.throws(() => validateQzSigningRequest("not json"), /valid JSON/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "printers.find", params: {} })), /timestamp/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "printers.find", params: {}, timestamp: Infinity })), /timestamp/);
  });
  it("rejects a digest that does not belong to the validated request", () => {
    const request = JSON.stringify({ call: "printers.find", params: {}, timestamp: Date.now() });
    assert.throws(() => signQzRequest(request, "0".repeat(64)), /digest does not match/);
  });
  it("enforces UTF-8 byte size and signs a representative multi-megabyte PDF request", () => {
    env.qzSigningRequestLimitMb = 1;
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "printers.find", params: { query: "é".repeat(600_000) }, timestamp: Date.now() })), /size limit/);
    env.qzSigningRequestLimitMb = 4;
    const data = "A".repeat(2 * 1024 * 1024);
    assert.ok(signed({ call: "print", params: { printer: { name: "P" }, options: {}, data: [{ type: "pixel", format: "pdf", flavor: "base64", data }] }, timestamp: Date.now() }));
  });
});
