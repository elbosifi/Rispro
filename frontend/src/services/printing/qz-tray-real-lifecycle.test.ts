import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WireMessage = {
  uid?: string;
  call?: string;
  params?: unknown;
  signature?: string;
  signAlgorithm?: string;
  timestamp?: number;
  certificate?: string | null;
  position?: unknown;
};

const sentMessages: WireMessage[] = [];

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    });
  }

  send(value: string): void {
    if (value === "ping") return;
    const message = JSON.parse(value) as WireMessage;
    sentMessages.push(message);
    let result: unknown = null;
    if (message.call === "getVersion") result = "2.2.6";
    if (message.call === "printers.find") result = ["RISPRO-LABEL"];
    queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ uid: message.uid, result }) })));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    queueMicrotask(() => this.onclose?.(new CloseEvent("close")));
  }
}

function desktopSignedContent(message: WireMessage): string {
  return JSON.stringify({ call: message.call, params: message.params, timestamp: message.timestamp });
}

function signLikeRispro(privateKey: KeyObject, content: string): string {
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  return sign("RSA-SHA512", Buffer.from(digest, "utf8"), privateKey).toString("base64");
}

function desktopVerifies(message: WireMessage, publicKey: KeyObject, algorithm: "SHA1" | "SHA512"): boolean {
  const digest = createHash("sha256").update(desktopSignedContent(message), "utf8").digest("hex");
  return verify(`RSA-${algorithm}`, Buffer.from(digest, "utf8"), publicKey, Buffer.from(message.signature!, "base64"));
}

describe("QZ Tray 2.2.6 real request lifecycle", () => {
  beforeEach(() => {
    sentMessages.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(async () => {
    const qz = await import("qz-tray");
    if (qz.websocket.isActive()) await qz.websocket.disconnect();
    vi.unstubAllGlobals();
  });

  it("keeps finalized A4 canonical media, explicit orientation, and zero-transform options in the real QZ config", async () => {
    vi.resetModules();
    const qz = await import("qz-tray");
    qz.security.setCertificatePromise((resolve) => resolve("test-certificate"));
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise(async () => { throw new Error("callback signing must not run"); });
    await qz.websocket.connect({ host: ["localhost"], port: { secure: [8181], insecure: [8182] }, usingSecure: true, keepAlive: 0 });
    for (const orientation of ["portrait", "landscape"] as const) {
      const config = qz.configs.create("RISPRO A4", {
        units: "mm",
        size: { width: 210, height: 297, custom: false } as qz.Size,
        orientation,
        copies: 1,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        scaleContent: false,
      });
      const options = (config as unknown as { getOptions(): Record<string, unknown> }).getOptions();
      expect(options).toEqual(expect.objectContaining({ orientation, size: { width: 210, height: 297, custom: false }, margins: { top: 0, right: 0, bottom: 0, left: 0 }, scaleContent: false, rotation: 0, spool: null }));
    }
  });

  it("adds SHA512 to pre-signed discovery and print transport while QZ desktop-style verification succeeds", async () => {
    vi.resetModules();
    const qz = await import("qz-tray");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    let callbackSigningCalls = 0;
    qz.security.setCertificatePromise((resolve) => resolve("test-certificate"));
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise(async () => { callbackSigningCalls += 1; throw new Error("callback signing must not run"); });
    await qz.websocket.connect({ host: ["localhost"], port: { secure: [8181], insecure: [8182] }, usingSecure: true, keepAlive: 0 });

    const dateNowBefore = Date.now;
    const discoveryTimestamp = 1_725_123_456_700;
    const discoveryContent = JSON.stringify({ call: "printers.find", params: {}, timestamp: discoveryTimestamp });
    const discoverySignature = signLikeRispro(privateKey, discoveryContent);
    await qz.printers.find(undefined, discoverySignature, discoveryTimestamp);

    const config = qz.configs.create("RISPRO-LABEL", { units: "mm", size: { width: 50, height: 30, custom: true } as qz.Size, orientation: "landscape", copies: 1 });
    const data = [{ type: "pixel" as const, format: "pdf" as const, flavor: "base64" as const, data: "JVBERi0xLjQ=" }];
    const runtimeConfig = config as unknown as { getPrinter(): unknown; getOptions(): unknown };
    expect(Object.keys(runtimeConfig.getOptions() as Record<string, unknown>).sort()).toEqual([
      "bounds", "colorType", "copies", "density", "duplex", "encoding", "fallbackDensity", "forceRaw", "interpolation", "jobName", "legacy",
      "margins", "orientation", "paperThickness", "printerTray", "rasterize", "rotation", "scaleContent", "size", "spool", "units",
    ]);
    const printTimestamp = 1_725_123_456_789;
    const printContent = JSON.stringify({ call: "print", params: { printer: runtimeConfig.getPrinter(), options: runtimeConfig.getOptions(), data }, timestamp: printTimestamp });
    const printSignature = signLikeRispro(privateKey, printContent);
    await (qz.print as unknown as (configuration: unknown, printData: unknown, signed: string, signedAt: number) => Promise<void>)(config, data, printSignature, printTimestamp);

    const signedMessages = sentMessages.filter((message) => message.call === "printers.find" || message.call === "print");
    expect(signedMessages).toHaveLength(2);
    expect(signedMessages.map((message) => message.signAlgorithm)).toEqual(["SHA512", "SHA512"]);
    expect(signedMessages.map((message) => message.timestamp)).toEqual([discoveryTimestamp, printTimestamp]);
    expect(signedMessages.map((message) => message.signature)).toEqual([discoverySignature, printSignature]);
    expect(desktopSignedContent(signedMessages[0])).toBe(discoveryContent);
    expect(desktopSignedContent(signedMessages[1])).toBe(printContent);
    for (const message of signedMessages) {
      expect(Object.keys(JSON.parse(desktopSignedContent(message)) as object)).toEqual(["call", "params", "timestamp"]);
      expect(desktopSignedContent(message)).not.toContain("signAlgorithm");
      expect(desktopSignedContent(message)).not.toContain("signature");
      expect(desktopSignedContent(message)).not.toContain("uid");
      expect(desktopSignedContent(message)).not.toContain("position");
      expect(desktopVerifies(message, publicKey, "SHA512")).toBe(true);
      expect(desktopVerifies(message, publicKey, "SHA1")).toBe(false);
    }
    expect(callbackSigningCalls).toBe(0);
    expect(Date.now).toBe(dateNowBefore);
  });

  it("keeps concurrent pre-signed calls associated with their own signatures, algorithms, and timestamps", async () => {
    vi.resetModules();
    const qz = await import("qz-tray");
    qz.security.setCertificatePromise((resolve) => resolve("test-certificate"));
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise(async () => { throw new Error("callback signing must not run"); });
    await qz.websocket.connect({ host: ["localhost"], port: { secure: [8181], insecure: [8182] }, usingSecure: true, keepAlive: 0 });
    const config = qz.configs.create("RISPRO-LABEL", { units: "mm", size: { width: 50, height: 30, custom: true } as qz.Size, orientation: "landscape", copies: 1 });
    const data = [{ type: "pixel" as const, format: "pdf" as const, flavor: "base64" as const, data: "JVBERi0xLjQ=" }];

    await Promise.all([
      qz.printers.find(undefined, "discovery-signature", 101),
      (qz.print as unknown as (configuration: unknown, printData: unknown, signed: string, signedAt: number) => Promise<void>)(config, data, "print-signature", 202),
    ]);

    const messages = sentMessages.filter((message) => message.call === "printers.find" || message.call === "print");
    expect(messages.map(({ call, signature, signAlgorithm, timestamp }) => ({ call, signature, signAlgorithm, timestamp }))).toEqual([
      { call: "printers.find", signature: "discovery-signature", signAlgorithm: "SHA512", timestamp: 101 },
      { call: "print", signature: "print-signature", signAlgorithm: "SHA512", timestamp: 202 },
    ]);
  });
});
