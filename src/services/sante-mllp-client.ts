import net from "net";

const START_BLOCK = 0x0b;
const END_BLOCK = 0x1c;
const CARRIAGE_RETURN = 0x0d;

export type SanteMllpAckCode = "AA" | "CA" | "AE" | "AR" | "CE" | "CR";

export interface SanteMllpSendResult {
  acknowledged: boolean;
  ackCode: SanteMllpAckCode | null;
  rawAck: string;
  error: string | null;
}

export class SanteMllpRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SanteMllpRetryableError";
  }
}

interface SanteMllpSocket {
  setTimeout(timeoutMs: number): void;
  write(buffer: Buffer, callback: (error?: Error | null) => void): void;
  removeAllListeners(): void;
  destroy(): void;
  on(event: "connect" | "data" | "timeout" | "error" | "end", listener: (...args: any[]) => void): this;
}

export function frameMllpMessage(message: string): Buffer {
  return Buffer.concat([
    Buffer.from([START_BLOCK]),
    Buffer.from(message, "utf8"),
    Buffer.from([END_BLOCK, CARRIAGE_RETURN]),
  ]);
}

function unframeMllpMessage(buffer: Buffer): string {
  const start = buffer[0] === START_BLOCK ? 1 : 0;
  const end = buffer.indexOf(Buffer.from([END_BLOCK, CARRIAGE_RETURN]));
  if (end < 0) throw new SanteMllpRetryableError("Malformed MLLP ACK: missing end frame.");
  return buffer.subarray(start, end).toString("utf8");
}

export function parseSanteMllpAck(rawAck: string): SanteMllpSendResult {
  const msa = rawAck.split(/\r/).find((segment) => segment.startsWith("MSA|"));
  const ackCode = msa?.split("|")[1] as SanteMllpAckCode | undefined;
  if (ackCode === "AA" || ackCode === "CA") {
    return { acknowledged: true, ackCode, rawAck, error: null };
  }
  if (ackCode === "AE" || ackCode === "AR" || ackCode === "CE" || ackCode === "CR") {
    return { acknowledged: false, ackCode, rawAck, error: `Sante MLLP negative ACK: ${ackCode}` };
  }
  throw new SanteMllpRetryableError("Malformed MLLP ACK: missing or unsupported MSA acknowledgement code.");
}

export async function sendSanteMllpMessage(input: {
  host: string;
  port: number;
  timeoutSeconds: number;
  message: string;
  expectAck: boolean;
  createConnection?: (options: net.NetConnectOpts) => SanteMllpSocket;
}): Promise<SanteMllpSendResult> {
  const timeoutMs = Math.max(1, input.timeoutSeconds) * 1000;
  const frame = frameMllpMessage(input.message);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = (input.createConnection || net.createConnection)({ host: input.host, port: input.port });

    const finish = (callback: () => void) => {
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      socket.write(frame, (error) => {
        if (error) {
          finish(() => reject(new SanteMllpRetryableError(`Sante MLLP send failed: ${error.message}`)));
          return;
        }
        if (!input.expectAck) {
          finish(() => resolve({ acknowledged: true, ackCode: null, rawAck: "", error: null }));
        }
      });
    });

    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.indexOf(Buffer.from([END_BLOCK, CARRIAGE_RETURN])) < 0) return;
      finish(() => {
        try {
          resolve(parseSanteMllpAck(unframeMllpMessage(data)));
        } catch (error) {
          reject(error);
        }
      });
    });

    socket.on("timeout", () => {
      finish(() => reject(new SanteMllpRetryableError("Sante MLLP ACK timed out.")));
    });
    socket.on("error", (error) => {
      finish(() => reject(new SanteMllpRetryableError(`Sante MLLP connection failed: ${error.message}`)));
    });
    socket.on("end", () => {
      if (input.expectAck) {
        finish(() => reject(new SanteMllpRetryableError("Sante MLLP connection closed before ACK.")));
      }
    });
  });
}
