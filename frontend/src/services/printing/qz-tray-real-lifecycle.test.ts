import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WireMessage = {
  uid?: string;
  call?: string;
  params?: unknown;
  signature?: string;
  timestamp?: number;
  certificate?: string | null;
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
    queueMicrotask(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ uid: message.uid, result }) })));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    queueMicrotask(() => this.onclose?.(new CloseEvent("close")));
  }
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

  it("sends the exact pre-signed print request with the explicit signature and timestamp", async () => {
    vi.resetModules();
    const qz = await import("qz-tray");
    const { serializeQzRequest, sha256Hex } = await import("./qz-tray-service");
    qz.security.setCertificatePromise((resolve) => resolve("test-certificate"));
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise(async () => { throw new Error("callback signing must not run"); });
    await qz.websocket.connect({ host: ["localhost"], port: { secure: [8181], insecure: [8182] }, usingSecure: true, keepAlive: 0 });

    const options = { units: "mm" as const, size: { width: 50, height: 30 }, copies: 1 };
    const config = qz.configs.create("RISPRO-LABEL", options);
    const data = [{ type: "pixel" as const, format: "pdf" as const, flavor: "base64" as const, data: "JVBERi0xLjQ=" }];
    const runtimeConfig = config as unknown as { getPrinter(): unknown; getOptions(): unknown };
    const params = { printer: runtimeConfig.getPrinter(), options: runtimeConfig.getOptions(), data };
    const timestamp = 1_725_123_456_789;
    const request = serializeQzRequest("print", params, timestamp);
    const digest = await sha256Hex(request);
    const signature = `rsa-sha512:${digest}`;
    const dateNowBefore = Date.now;

    await (qz.print as unknown as (configuration: unknown, printData: unknown, signed: string, signedAt: number) => Promise<void>)(config, data, signature, timestamp);

    const wire = sentMessages.find((message) => message.call === "print");
    expect(wire).toBeDefined();
    expect(JSON.stringify({ call: wire!.call, params: wire!.params, timestamp: wire!.timestamp })).toBe(request);
    expect(wire).toMatchObject({ signature, timestamp });
    expect(await sha256Hex(JSON.stringify({ call: wire!.call, params: wire!.params, timestamp: wire!.timestamp }))).toBe(digest);
    expect(Date.now).toBe(dateNowBefore);
  });
});
