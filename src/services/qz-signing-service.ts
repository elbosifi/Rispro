import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, X509Certificate, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export const QZ_SIGNING_CALL_ALLOWLIST = ["printers.find", "print"] as const;
const ALLOWED_CALLS = new Set<string>(QZ_SIGNING_CALL_ALLOWLIST);
const QZ_PRINT_OPTION_KEYS = new Set([
  "bounds", "colorType", "copies", "density", "duplex", "encoding", "fallbackDensity", "forceRaw", "interpolation", "jobName", "legacy",
  "margins", "orientation", "paperThickness", "printerTray", "rasterize", "rotation", "scaleContent", "size", "spool", "units",
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type QzTrustMode = "internal_ca" | "qz_issued";

export type QzIdentity = {
  trustMode: QzTrustMode;
  rootCertificate: string | null;
  signingCertificate: string;
  signingPrivateKey: string;
  root: X509Certificate | null;
  signing: X509Certificate;
  privateKey: KeyObject;
};

function configuredPem(fileName: string, inlineName: string | null, label: string): string {
  const configuredPath = String(process.env[fileName] || "").trim();
  if (configuredPath) {
    try {
      const value = readFileSync(configuredPath, "utf8").trim();
      if (!value) throw new Error("file is empty");
      return value;
    } catch {
      throw new HttpError(503, `${label} file is configured but could not be read.`);
    }
  }
  const inline = inlineName ? String(process.env[inlineName] || "").trim().replace(/\\n/g, "\n") : "";
  if (!inline) throw new HttpError(503, `${label} is not configured.`);
  return inline;
}

function assertRsaPkcs8(privateKeyPem: string, privateKey: KeyObject): void {
  if (!/^-----BEGIN PRIVATE KEY-----/m.test(privateKeyPem)) throw new HttpError(503, "QZ signing private key must use PKCS#8 PEM format.");
  if (privateKey.asymmetricKeyType !== "rsa") throw new HttpError(503, "QZ signing private key must be RSA.");
  if ((privateKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new HttpError(503, "QZ signing private key must be at least 2048 bits.");
}

function publicDer(key: KeyObject): Buffer {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  return publicKey.export({ format: "der", type: "spki" });
}

function assertCertificateCurrentlyValid(certificate: Pick<X509Certificate, "validFrom" | "validTo">, message: string, now = Date.now()): void {
  if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) throw new HttpError(503, message);
}

export function loadValidatedQzIdentity(): QzIdentity {
  const trustMode = env.qzTrustMode;
  if (!trustMode) throw new HttpError(503, "QZ_TRUST_MODE is not configured.");
  const signingCertificate = configuredPem("QZ_CERTIFICATE_FILE", "QZ_CERTIFICATE", "QZ signing certificate");
  const signingPrivateKey = configuredPem("QZ_PRIVATE_KEY_FILE", "QZ_PRIVATE_KEY", "QZ signing private key");
  let signing: X509Certificate;
  let privateKey: KeyObject;
  try { signing = new X509Certificate(signingCertificate); } catch { throw new HttpError(503, "QZ signing certificate is invalid."); }
  try { privateKey = createPrivateKey(signingPrivateKey); } catch { throw new HttpError(503, "QZ signing private key is invalid."); }
  assertRsaPkcs8(signingPrivateKey, privateKey);
  if (signing.ca) throw new HttpError(503, "QZ signing certificate must not be a CA certificate.");
  assertCertificateCurrentlyValid(signing, "QZ signing certificate is not currently valid.");
  if (!publicDer(signing.publicKey).equals(publicDer(privateKey))) throw new HttpError(503, "QZ signing certificate does not match the private key.");

  let rootCertificate: string | null = null;
  let root: X509Certificate | null = null;
  if (trustMode === "internal_ca") {
    rootCertificate = configuredPem("QZ_ROOT_CERTIFICATE_FILE", null, "QZ root certificate");
    try { root = new X509Certificate(rootCertificate); } catch { throw new HttpError(503, "QZ root certificate is invalid."); }
    assertCertificateCurrentlyValid(root, "QZ root certificate is not currently valid.");
    if (!root.ca) throw new HttpError(503, "QZ root certificate must be a CA certificate.");
    if (root.subject !== root.issuer || !root.verify(root.publicKey)) throw new HttpError(503, "QZ root certificate must be self-issued and self-signed.");
    if (signing.issuer !== root.subject || !signing.verify(root.publicKey)) throw new HttpError(503, "QZ signing certificate does not chain to the configured root.");
  }
  return { trustMode, rootCertificate, signingCertificate, signingPrivateKey, root, signing, privateKey };
}

export function validateConfiguredQzIdentityAtStartup(): void {
  if (env.qzTrustMode) loadValidatedQzIdentity();
}

function legacyPem(name: "QZ_CERTIFICATE" | "QZ_PRIVATE_KEY"): string {
  return configuredPem(name === "QZ_CERTIFICATE" ? "QZ_CERTIFICATE_FILE" : "QZ_PRIVATE_KEY_FILE", name, name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reject(message: string, statusCode = 403): never {
  throw new HttpError(statusCode, message);
}

function validatePrinterDiscovery(params: unknown): void {
  if (!isRecord(params) || Object.keys(params).some((key) => key !== "query")) reject("QZ printer-discovery parameters are invalid.", 400);
  if (params.query != null && typeof params.query !== "string") reject("QZ printer-discovery query is invalid.", 400);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validatePrintOptions(options: unknown): void {
  if (!isRecord(options) || Object.keys(options).some((key) => !QZ_PRINT_OPTION_KEYS.has(key))) reject("QZ print options contain an unapproved field.", 400);

  const printerTray = options.printerTray;
  if (printerTray !== null && (typeof printerTray !== "string" || printerTray !== printerTray.trim() || printerTray.length === 0 || printerTray.length > 255 || CONTROL_CHARACTERS.test(printerTray))) {
    reject("QZ printer tray is invalid.", 400);
  }
  if (options.units !== "mm") reject("QZ print units must be millimetres.", 400);
  if (!Number.isInteger(options.copies) || Number(options.copies) < 1 || Number(options.copies) > 99) reject("QZ print copies are invalid.", 400);
  if (options.orientation !== null && options.orientation !== "portrait" && options.orientation !== "landscape") reject("QZ print orientation is invalid.", 400);
  if (typeof options.scaleContent !== "boolean" || typeof options.rasterize !== "boolean") reject("QZ print boolean options are invalid.", 400);
  if (typeof options.jobName !== "string" || !options.jobName.trim() || options.jobName.length > 200 || CONTROL_CHARACTERS.test(options.jobName)) reject("QZ print job name is invalid.", 400);

  const defaultA4LandscapeMedia = options.size === null;
  let width = 0;
  let height = 0;
  let canonicalA4 = false;
  let finalizedPdfGeometry = false;
  if (defaultA4LandscapeMedia) {
    if (options.orientation !== null || options.scaleContent !== false) reject("QZ default-media landscape options are invalid.", 400);
    finalizedPdfGeometry = true;
  } else {
    const size = options.size;
    if (!isRecord(size) || !hasExactKeys(size, ["width", "height", "custom"])) reject("QZ print size is invalid.", 400);
    const parsedWidth = size.width;
    const parsedHeight = size.height;
    if (typeof parsedWidth !== "number" || !Number.isFinite(parsedWidth) || parsedWidth < 10 || parsedWidth > 500 || typeof parsedHeight !== "number" || !Number.isFinite(parsedHeight) || parsedHeight < 10 || parsedHeight > 1000 || typeof size.custom !== "boolean") reject("QZ print size is invalid.", 400);
    width = parsedWidth;
    height = parsedHeight;
    canonicalA4 = width === 210 && height === 297;
    const standardMedia = canonicalA4 || (width === 148 && height === 210);
    if ((width === 297 && height === 210) || size.custom === standardMedia) reject("QZ print custom-media setting is inconsistent with its dimensions.", 400);
    const expectedOrientation = width > height ? "landscape" : "portrait";
    finalizedPdfGeometry = canonicalA4 && size.custom === false && options.orientation === null;
    const finalizedA4Landscape = canonicalA4 && size.custom === false && options.orientation === "landscape";
    const canonicalA4Orientation = canonicalA4 && size.custom === false && (options.orientation === "portrait" || options.orientation === "landscape");
    if (!finalizedPdfGeometry && !canonicalA4Orientation && options.orientation !== expectedOrientation) reject("QZ print orientation does not match its physical dimensions.", 400);
    finalizedPdfGeometry ||= finalizedA4Landscape;
  }

  if (!isRecord(options.margins) || !hasExactKeys(options.margins, ["top", "right", "bottom", "left"])) reject("QZ print margins are invalid.", 400);
  const margins = options.margins as Record<"top" | "right" | "bottom" | "left", unknown>;
  if (Object.values(margins).some((margin) => typeof margin !== "number" || !Number.isFinite(margin) || margin < 0)
      || (!defaultA4LandscapeMedia && (Number(margins.left) >= width || Number(margins.right) >= width || Number(margins.top) >= height || Number(margins.bottom) >= height
      || Number(margins.left) + Number(margins.right) >= width || Number(margins.top) + Number(margins.bottom) >= height))) reject("QZ print margins are invalid.", 400);
  if (finalizedPdfGeometry && (Object.values(margins).some((margin) => margin !== 0) || options.scaleContent !== false)) {
    reject("Finalized A4 PDF options must preserve page geometry.", 400);
  }

  const expectedDefaults: Record<string, unknown> = {
    bounds: null, colorType: "color", density: 0, duplex: false, encoding: null, fallbackDensity: null, forceRaw: false, interpolation: "bicubic",
    legacy: false, paperThickness: null, rotation: 0, spool: null,
  };
  for (const [key, expected] of Object.entries(expectedDefaults)) {
    if (!Object.hasOwn(options, key) || options[key] !== expected) reject(`QZ print option ${key} is not approved.`, 400);
  }
}

type Base64SegmentDecoder = (value: string) => Buffer;

function decodeBase64Segment(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function validateBase64Syntax(value: string): void {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    reject("QZ PDF data is not valid Base64.", 400);
  }
}

function validateBase64PdfHeader(value: string, decode: Base64SegmentDecoder): void {
  const prefix = decode(value.slice(0, 8));
  if (prefix.length < 5 || prefix.subarray(0, 5).toString("ascii") !== "%PDF-") {
    reject("QZ print data is not a PDF document.", 400);
  }
}

function validateCanonicalBase64Tail(value: string, decode: Base64SegmentDecoder): void {
  const finalQuartet = value.slice(-4);
  if (decode(finalQuartet).toString("base64") !== finalQuartet) {
    reject("QZ PDF data is not canonical Base64.", 400);
  }
}

function validateBase64Pdf(value: unknown, decode: Base64SegmentDecoder = decodeBase64Segment): void {
  if (typeof value !== "string" || value.length === 0) reject("QZ PDF data is invalid.", 400);
  if (/^data:/i.test(value)) reject("QZ PDF data must not use a data URL.", 400);
  validateBase64Syntax(value);
  validateBase64PdfHeader(value, decode);
  validateCanonicalBase64Tail(value, decode);
}

function validatePrint(params: unknown): void {
  if (!isRecord(params) || Object.keys(params).some((key) => !["printer", "options", "data"].includes(key))) {
    reject("QZ print parameters are invalid.", 400);
  }
  if (!isRecord(params.printer) || typeof params.printer.name !== "string" || params.printer.name !== params.printer.name.trim() || params.printer.name.length < 1 || params.printer.name.length > 255 || CONTROL_CHARACTERS.test(params.printer.name) || Object.keys(params.printer).some((key) => key !== "name")) {
    reject("QZ print requests must target one named local printer.", 403);
  }
  if (!Array.isArray(params.data) || params.data.length !== 1) reject("Exactly one PDF document is required for QZ printing.", 400);
  validatePrintOptions(params.options);
  const item = params.data[0];
  if (!isRecord(item) || Object.keys(item).some((key) => !["type", "format", "flavor", "data"].includes(key)) || item.type !== "pixel" || item.format !== "pdf" || item.flavor !== "base64") {
    reject("Only Base64 pixel PDF print data may be signed.", 403);
  }
  validateBase64Pdf(item.data);
}

export function qzSigningRequestLimitBytes(): number {
  return env.qzSigningRequestLimitMb * 1024 * 1024;
}

export function validateQzSigningRequest(request: unknown): string {
  if (typeof request !== "string" || request.length === 0) reject("A valid QZ request is required.", 400);
  if (Buffer.byteLength(request, "utf8") > qzSigningRequestLimitBytes()) throw new HttpError(413, "QZ signing request exceeds the configured size limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(request); } catch { reject("QZ signing request must be valid JSON.", 400); }
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["call", "params", "timestamp"].includes(key))) reject("QZ signing request has an invalid structure.", 400);
  if (typeof parsed.call !== "string" || !ALLOWED_CALLS.has(parsed.call)) reject("This QZ function is not approved for RISpro printing.", 403);
  if (!Number.isSafeInteger(parsed.timestamp) || Number(parsed.timestamp) <= 0) reject("QZ signing request timestamp is invalid.", 400);
  if (parsed.call === "print") validatePrint(parsed.params); else validatePrinterDiscovery(parsed.params);
  return request;
}

export function getQzCertificate(): string { return env.qzTrustMode ? loadValidatedQzIdentity().signingCertificate : legacyPem("QZ_CERTIFICATE"); }

export function getQzRootCertificate(): string {
  const root = loadValidatedQzIdentity().rootCertificate;
  if (!root) throw new HttpError(404, "A custom QZ root certificate is not used in qz_issued mode.");
  return root;
}

export function signQzRequest(request: unknown, digest: unknown): string {
  const payload = validateQzSigningRequest(request);
  const expectedDigest = createHash("sha256").update(payload, "utf8").digest("hex");
  if (digest !== undefined) {
    const suppliedDigest = typeof digest === "string" && /^[0-9a-f]{64}$/i.test(digest) ? digest.toLowerCase() : "";
    if (!suppliedDigest || !timingSafeEqual(Buffer.from(suppliedDigest, "hex"), Buffer.from(expectedDigest, "hex"))) throw new HttpError(400, "QZ signing digest does not match the validated request.");
  }
  try {
    const key = env.qzTrustMode ? loadValidatedQzIdentity().privateKey : createPrivateKey(legacyPem("QZ_PRIVATE_KEY"));
    return sign("RSA-SHA512", Buffer.from(expectedDigest, "utf8"), key).toString("base64");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "QZ request signing failed.");
  }
}

export const __qzSigningTestables = {
  assertCertificateCurrentlyValid,
  validateBase64Pdf,
};
