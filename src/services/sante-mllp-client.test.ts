import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  frameMllpMessage,
  parseSanteMllpAck,
  sendSanteMllpMessage,
  SanteMllpRetryableError,
} from "./sante-mllp-client.js";

class FakeMllpSocket extends EventEmitter {
  written: Buffer | null = null;
  destroyed = false;

  setTimeout(_timeoutMs: number): void {
    return;
  }

  write(buffer: Buffer, callback: (error?: Error | null) => void): void {
    this.written = buffer;
    callback();
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function ackFrame(code: string): Buffer {
  return frameMllpMessage(`MSH|^~\\&|SANTE|SANTE|RISPRO|RISPRO|202605101200||ACK^O01|ACK-1|P|2.3.1\rMSA|${code}|RISPRO-TEST\r`);
}

test("frameMllpMessage wraps HL7 with MLLP start and end bytes", () => {
  assert.deepEqual(
    [...frameMllpMessage("MSH|TEST\r")],
    [0x0b, ...Buffer.from("MSH|TEST\r", "utf8"), 0x1c, 0x0d]
  );
});

test("parseSanteMllpAck treats AA and CA as success", () => {
  assert.equal(parseSanteMllpAck("MSH|x\rMSA|AA|1\r").acknowledged, true);
  assert.equal(parseSanteMllpAck("MSH|x\rMSA|CA|1\r").acknowledged, true);
});

test("parseSanteMllpAck treats AE as negative ACK", () => {
  const result = parseSanteMllpAck("MSH|x\rMSA|AE|1\r");
  assert.equal(result.acknowledged, false);
  assert.equal(result.ackCode, "AE");
});

test("parseSanteMllpAck rejects malformed ACK as retryable", () => {
  assert.throws(() => parseSanteMllpAck("MSH|x\r"), SanteMllpRetryableError);
});

test("sendSanteMllpMessage reads framed AA ACK", async () => {
  const socket = new FakeMllpSocket();
  const resultPromise = sendSanteMllpMessage({
    host: "127.0.0.1",
    port: 2575,
    timeoutSeconds: 1,
    message: "MSH|TEST\r",
    expectAck: true,
    createConnection: () => socket,
  });

  socket.emit("connect");
  socket.emit("data", ackFrame("AA"));

  const result = await resultPromise;
  assert.equal(result.acknowledged, true);
  assert.equal(result.ackCode, "AA");
});

test("sendSanteMllpMessage times out waiting for ACK", async () => {
  const socket = new FakeMllpSocket();
  const resultPromise = sendSanteMllpMessage({
    host: "127.0.0.1",
    port: 2575,
    timeoutSeconds: 1,
    message: "MSH|TEST\r",
    expectAck: true,
    createConnection: () => socket,
  });

  socket.emit("connect");
  socket.emit("timeout");

  await assert.rejects(() => resultPromise, SanteMllpRetryableError);
});
