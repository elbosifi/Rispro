import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { env } from "../config/env.js";
import { __qzSigningTestables, getQzCertificate, signQzRequest, validateQzSigningRequest } from "./qz-signing-service.js";

const originalCertificate = process.env.QZ_CERTIFICATE;
const originalPrivateKey = process.env.QZ_PRIVATE_KEY;
const originalLimit = env.qzSigningRequestLimitMb;
let publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"];
const VALID_PDF_BASE64 = Buffer.from("%PDF-1.4\nx").toString("base64");

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
  const signature = signQzRequest(request, undefined);
  assert.equal(verify("RSA-SHA512", Buffer.from(digest), publicKey, Buffer.from(signature, "base64")), true);
  return signature;
}

function printOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bounds: null,
    colorType: "color",
    copies: 1,
    density: 0,
    duplex: false,
    encoding: null,
    fallbackDensity: null,
    forceRaw: false,
    interpolation: "bicubic",
    jobName: "RISpro print test",
    legacy: false,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    orientation: "portrait",
    paperThickness: null,
    printerTray: null,
    rasterize: false,
    rotation: 0,
    scaleContent: true,
    size: { width: 210, height: 297, custom: false },
    spool: null,
    units: "mm",
    ...overrides,
  };
}

function pdfItem(data: unknown = VALID_PDF_BASE64): Record<string, unknown> {
  return { type: "pixel", format: "pdf", flavor: "base64", data };
}

function printPayload(options: Record<string, unknown>, printer: Record<string, unknown> = { name: "RISPRO A4" }, data: unknown = [pdfItem()]): object {
  return { call: "print", params: { printer, options, data }, timestamp: Date.now() };
}

function validationError(payload: object): string {
  try {
    validateQzSigningRequest(JSON.stringify(payload));
    assert.fail("Expected QZ signing validation to reject the payload.");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("QZ request signing", () => {
  it("accepts a currently valid root interval and rejects expired or not-yet-valid roots", () => {
    const now = Date.parse("2026-08-01T12:00:00Z");
    assert.doesNotThrow(() => __qzSigningTestables.assertCertificateCurrentlyValid({ validFrom: "2026-07-01T00:00:00Z", validTo: "2027-07-01T00:00:00Z" }, "QZ root certificate is not currently valid.", now));
    assert.throws(() => __qzSigningTestables.assertCertificateCurrentlyValid({ validFrom: "2025-01-01T00:00:00Z", validTo: "2026-07-31T00:00:00Z" }, "QZ root certificate is not currently valid.", now), /QZ root certificate is not currently valid/);
    assert.throws(() => __qzSigningTestables.assertCertificateCurrentlyValid({ validFrom: "2026-08-02T00:00:00Z", validTo: "2027-08-02T00:00:00Z" }, "QZ root certificate is not currently valid.", now), /QZ root certificate is not currently valid/);
  });

  it("signs the exact QZ 2.2.6 discovery call and rejects printer details", () => {
    assert.equal(getQzCertificate(), "test-certificate");
    assert.ok(signed({ call: "printers.find", params: {}, timestamp: Date.now() }));
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "printers.detail", timestamp: Date.now() })), /not approved/);
  });
  it("accepts physical portrait and landscape A4, A5, and 50 x 30 mm label options", () => {
    assert.ok(signed(printPayload(printOptions())));
    assert.ok(signed(printPayload(printOptions({ orientation: "landscape", margins: { top: 0, right: 0, bottom: 0, left: 0 }, scaleContent: false, jobName: "RISpro registration list" }))));
    assert.ok(signed(printPayload(printOptions({ size: { width: 148, height: 210, custom: false }, jobName: "RISpro A5" }))));
    assert.ok(signed(printPayload(printOptions({ size: { width: 50, height: 30, custom: true }, orientation: "landscape", scaleContent: false, rasterize: true, printerTray: "Tray 1", jobName: "RISpro label" }))));
  });
  it("accepts canonical A4 portrait and strict finalized landscape options", () => {
    const finalized = { orientation: "landscape", margins: { top: 0, right: 0, bottom: 0, left: 0 }, scaleContent: false };
    assert.ok(signed(printPayload(printOptions({ orientation: "portrait" }))));
    assert.ok(signed(printPayload(printOptions(finalized))));
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ ...finalized, size: { width: 297, height: 210, custom: false } })))), /custom-media/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ ...finalized, scaleContent: true })))), /preserve page geometry/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ ...finalized, margins: { top: 1, right: 0, bottom: 0, left: 0 } })))), /preserve page geometry/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ ...finalized, orientation: null })))), /orientation/);
  });
  it("requires exactly one flat PDF data item", () => {
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, [])), /Exactly one PDF/);
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, [pdfItem(), pdfItem()])), /Exactly one PDF/);
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, "not-an-array")), /Exactly one PDF/);
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, [[pdfItem()]])), /Base64 pixel PDF/);
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, [pdfItem(), { type: "raw", format: "command", flavor: "plain", data: "PRINT" }])), /Exactly one PDF/);
  });
  it("accepts only canonical unwrapped Base64 whose decoded bytes begin with a PDF header", () => {
    const canonicalCases = [
      Buffer.from("%PDF-1.4\n").toString("base64"),
      Buffer.from("%PDF-1.4\nxx").toString("base64"),
      Buffer.from("%PDF-1.4\nx").toString("base64"),
      Buffer.from("%PDF-1.7\nrealistic test document body\n%%EOF\n").toString("base64"),
    ];
    assert.equal(canonicalCases[0].endsWith("="), false);
    assert.equal(canonicalCases[1].endsWith("="), true);
    assert.equal(canonicalCases[1].endsWith("=="), false);
    assert.equal(canonicalCases[2].endsWith("=="), true);
    for (const data of canonicalCases) assert.ok(signed(printPayload(printOptions(), { name: "P" }, [pdfItem(data)])));

    const noncanonicalPadBits = `${VALID_PDF_BASE64.slice(0, -4)}eB==`;
    const invalidCases: Array<[unknown, RegExp]> = [
      ["", /PDF data is invalid/],
      ["JVBERi0*", /not valid Base64/],
      ["JVBERi0===", /not valid Base64/],
      ["JVBERi0", /not valid Base64/],
      ["JVBE=Ri0", /not valid Base64/],
      ["JVBERi0_", /not valid Base64/],
      [noncanonicalPadBits, /not canonical Base64/],
      [` ${VALID_PDF_BASE64}`, /not valid Base64/],
      [`${VALID_PDF_BASE64} `, /not valid Base64/],
      [`${VALID_PDF_BASE64}\n`, /not valid Base64/],
      [`${VALID_PDF_BASE64}\t`, /not valid Base64/],
      [`data:application/pdf;base64,${VALID_PDF_BASE64}`, /must not use a data URL/],
      [Buffer.from("plain text").toString("base64"), /not a PDF document/],
      [Buffer.from("<html>print</html>").toString("base64"), /not a PDF document/],
      [Buffer.from("\u001b@raw printer command").toString("base64"), /not a PDF document/],
      [Buffer.from("%PNG-not-a-pdf").toString("base64"), /not a PDF document/],
      [VALID_PDF_BASE64.replace(/=+$/, ""), /not valid Base64/],
    ];
    for (const [data, expected] of invalidCases) assert.match(validationError(printPayload(printOptions(), { name: "P" }, [pdfItem(data)])), expected);
  });
  it("rejects unknown print-item fields and wrong QZ PDF metadata", () => {
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, [{ ...pdfItem(), extra: true }])), /Base64 pixel PDF/);
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, [{ ...pdfItem(), type: "raw" }])), /Base64 pixel PDF/);
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, [{ ...pdfItem(), format: "html" }])), /Base64 pixel PDF/);
    assert.match(validationError(printPayload(printOptions(), { name: "P" }, [{ ...pdfItem(), flavor: "plain" }])), /Base64 pixel PDF/);
  });
  it("does not include rejected document data in validation errors", () => {
    const submitted = Buffer.from("patient-secret-not-a-pdf").toString("base64");
    const message = validationError(printPayload(printOptions(), { name: "P" }, [pdfItem(submitted)]));
    assert.doesNotMatch(message, new RegExp(submitted));
  });
  it("rejects unknown, file, socket, USB, HID, raw, and HTML print calls", () => {
    for (const call of ["unknown.call", "file.read", "socket.sendData", "usb.listDevices", "hid.listDevices"]) assert.throws(() => validateQzSigningRequest(JSON.stringify({ call, params: {}, timestamp: Date.now() })), /not approved/);
    const options = printOptions();
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ ...printPayload(options), params: { printer: { name: "P" }, options, data: [{ type: "raw", format: "command", flavor: "plain", data: "danger" }] } })), /Base64 pixel PDF/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ ...printPayload(options), params: { printer: { name: "P" }, options, data: [{ type: "pixel", format: "html", flavor: "plain", data: "<p>unsafe</p>" }] } })), /Base64 pixel PDF/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ ...printPayload(options), params: { printer: { name: "P" }, options, data: [{ type: "pixel", format: "pdf", flavor: "file", data: "file:///patient.pdf" }] } })), /Base64 pixel PDF/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ forceRaw: true })))), /forceRaw/);
  });
  it("rejects invalid copies, units, unknown options, dimensions, custom flags, and orientation", () => {
    for (const copies of [0, 100, 1.5]) assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ copies })))), /copies/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ units: "in" })))), /units/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ unapproved: true })))), /unapproved field/);
    for (const size of [{ width: Infinity, height: 297, custom: false }, { width: 501, height: 297, custom: true }, { width: 210, height: 297, custom: true }, { width: 50, height: 30, custom: false }]) {
      assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ size })))), /size|custom-media/);
    }
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ size: { width: 50, height: 30, custom: true }, orientation: "portrait" })))), /orientation/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ orientation: "landscape" })))), /preserve page geometry/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ size: { width: 297, height: 210, custom: false }, orientation: "landscape" })))), /custom-media/);
  });
  it("rejects invalid margins, job names, trays, and boolean options", () => {
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ margins: { top: -1, right: 0, bottom: 0, left: 0 } })))), /margins/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ margins: { top: 0, right: 110, bottom: 0, left: 100 } })))), /margins/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ jobName: "x".repeat(201) })))), /job name/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ jobName: "RISpro\njob" })))), /job name/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ printerTray: { name: "Tray 1" } })))), /tray/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ printerTray: "Tray\u0000One" })))), /tray/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ rasterize: "true" })))), /boolean/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions({ scaleContent: "true" })))), /boolean/);
  });
  it("rejects file and network printer targets and invalid local queue names", () => {
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions(), { name: "P", file: "C:\\patient.pdf" }))), /named local printer/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions(), { name: "P", host: "10.0.0.5", port: 9100 }))), /named local printer/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify(printPayload(printOptions(), { name: " P " }))), /named local printer/);
  });
  it("rejects malformed JSON and missing or invalid timestamps", () => {
    assert.throws(() => validateQzSigningRequest("not json"), /valid JSON/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "printers.find", params: {} })), /timestamp/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "printers.find", params: {}, timestamp: Infinity })), /timestamp/);
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "printers.find", params: {}, timestamp: Date.now(), unexpected: true })), /invalid structure/);
  });
  it("rejects a digest that does not belong to the validated request", () => {
    const request = JSON.stringify({ call: "printers.find", params: {}, timestamp: Date.now() });
    assert.throws(() => signQzRequest(request, "0".repeat(64)), /digest does not match/);
  });
  it("accepts a matching supplied digest and signs the same server-computed digest", () => {
    const request = JSON.stringify({ call: "printers.find", params: {}, timestamp: Date.now() });
    const digest = createHash("sha256").update(request, "utf8").digest("hex");
    const signature = signQzRequest(request, digest);
    assert.equal(verify("RSA-SHA512", Buffer.from(digest), publicKey, Buffer.from(signature, "base64")), true);
  });
  it("enforces UTF-8 byte size and signs a representative multi-megabyte PDF request", () => {
    env.qzSigningRequestLimitMb = 1;
    assert.throws(() => validateQzSigningRequest(JSON.stringify({ call: "printers.find", params: { query: "é".repeat(600_000) }, timestamp: Date.now() })), /size limit/);
    env.qzSigningRequestLimitMb = 4;
    const pdfBytes = Buffer.alloc(2 * 1024 * 1024, 0x20);
    Buffer.from("%PDF-1.4\n").copy(pdfBytes);
    const data = pdfBytes.toString("base64");
    const payload = printPayload(printOptions(), { name: "P" }) as { params: { data: Array<Record<string, unknown>> } };
    payload.params.data[0].data = data;
    assert.ok(signed(payload));
  });

  it("decodes only bounded Base64 prefix and tail segments for a multi-megabyte PDF", () => {
    const pdfBytes = Buffer.alloc(3 * 1024 * 1024, 0x20);
    Buffer.from("%PDF-1.7\n").copy(pdfBytes);
    const data = pdfBytes.toString("base64");
    const decodedSegmentLengths: number[] = [];

    __qzSigningTestables.validateBase64Pdf(data, (segment) => {
      decodedSegmentLengths.push(segment.length);
      return Buffer.from(segment, "base64");
    });

    assert.deepEqual(decodedSegmentLengths, [8, 4]);
    assert.equal(Math.max(...decodedSegmentLengths), 8);
  });
});
