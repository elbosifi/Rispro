import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import crypto from "node:crypto";
import { HttpError } from "../../utils/http-error.js";

export interface MedAsrConnection {
  baseUrl: string;
  timeoutSeconds: number;
  allowInsecureHttp: boolean;
}
export interface DictationAudio { buffer: Buffer; mimeType: string }
export interface TranscriptionResult { text: string; processing_seconds: number }
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const audioFormats: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3",
};
const blocked = new BlockList();
const blockedV6 = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["127.0.0.0", 8], ["169.254.0.0", 16], ["100.64.0.0", 10], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(address, prefix);
for (const [address, prefix] of [["::", 96], ["::ffff:0:0", 96], ["fe80::", 10], ["ff00::", 8], ["2001::", 32], ["2002::", 16], ["64:ff9b::", 96]] as const) blockedV6.addSubnet(address, prefix, "ipv6");
blockedV6.addAddress("::1", "ipv6");
blockedV6.addAddress("fd00:ec2::254", "ipv6");
const internal = new BlockList();
internal.addSubnet("10.0.0.0", 8); internal.addSubnet("172.16.0.0", 12); internal.addSubnet("192.168.0.0", 16); internal.addSubnet("fc00::", 7, "ipv6");

export function validateTargetAddress(address: string, connection: MedAsrConnection): void {
  const family = isIP(address) === 6 ? "ipv6" : "ipv4";
  if (!isIP(address) || (family === "ipv6" ? blockedV6 : blocked).check(address, family)) throw new HttpError(400, "MedASR address resolves to a prohibited destination.");
  if (new URL(connection.baseUrl).protocol === "http:" && (!connection.allowInsecureHttp || !internal.check(address, family))) {
    throw new HttpError(400, "HTTP MedASR requires a private-network address and protected-network acknowledgement. Use HTTPS otherwise.");
  }
}

export function validateMedAsrUrl(connection: MedAsrConnection): string {
  let url: URL;
  try { url = new URL(connection.baseUrl); } catch { throw new HttpError(400, "Enter a valid MedASR server address."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new HttpError(400, "MedASR address must be an HTTP(S) origin without credentials, path, query or fragment.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal" || hostname.endsWith(".metadata.google.internal")) throw new HttpError(400, "MedASR address is prohibited.");
  if (isIP(hostname)) validateTargetAddress(hostname, connection);
  if (url.protocol === "http:" && !connection.allowInsecureHttp) throw new HttpError(400, "Acknowledge the protected internal network before using HTTP MedASR.");
  return url.origin;
}

export function validateAudio(audio: DictationAudio): string {
  if (!audio.buffer.length) throw new HttpError(400, "A non-empty audio recording is required.");
  if (audio.buffer.length > MAX_AUDIO_BYTES) throw new HttpError(413, "Audio exceeds the 15 MB limit.");
  const mimeType = audio.mimeType.split(";")[0].trim().toLowerCase();
  if (!audioFormats[mimeType]) throw new HttpError(415, "Unsupported audio format. Use WebM, Ogg, MP4, WAV or MP3 audio.");
  // Check the container as well as the supplied MIME type; never trust a filename.
  const b = audio.buffer;
  const matches = mimeType === "audio/webm" ? b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : mimeType === "audio/ogg" ? b.toString("ascii", 0, 4) === "OggS"
    : mimeType === "audio/mp4" ? b.toString("ascii", 4, 8) === "ftyp"
    : mimeType === "audio/mpeg" ? b.toString("ascii", 0, 3) === "ID3" || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
    : b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE";
  if (!matches) throw new HttpError(415, "Audio content does not match the selected format.");
  return mimeType;
}

// Validate every DNS answer and supply that exact address to the socket lookup.
// No redirects, proxy environment variables, or second unvalidated DNS lookup.
async function request(connection: MedAsrConnection, path: "/health" | "/transcribe", body?: Buffer, headers: http.OutgoingHttpHeaders = {}, signal?: AbortSignal): Promise<unknown> {
  const baseUrl = validateMedAsrUrl(connection);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, connection.timeoutSeconds * 1000);
  try {
    return await new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const transport = url.protocol === "https:" ? https : http;
      const req = transport.request(url, {
        method: body ? "POST" : "GET", signal: controller.signal,
        headers: { Accept: "application/json", ...headers, ...(body ? { "Content-Length": body.length } : {}) },
        lookup(hostname, _options, callback) {
          dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error) return callback(error, "", 4);
            try {
              if (!addresses.length) throw new Error("No addresses");
              addresses.forEach(({ address }) => validateTargetAddress(address, connection));
              // Request one address so Node cannot choose a different DNS answer.
              if (_options.all) callback(null, [addresses[0]]);
              else callback(null, addresses[0].address, addresses[0].family);
            } catch (e) { callback(e as Error, "", 4); }
          });
        },
        agent: false,
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          res.destroy();
          reject(new HttpError(502, status === 401 || status === 403 ? "MedASR rejected authentication. Check the saved API key." : status >= 300 && status < 400 ? "MedASR redirects are not permitted." : "MedASR service returned an unsuccessful response.", { code: status === 401 || status === 403 ? "MEDASR_AUTH" : "MEDASR_RESPONSE" }));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) { res.destroy(); reject(new HttpError(502, "MedASR response is too large.", { code: "MEDASR_RESPONSE" })); }
          else chunks.push(chunk);
        });
        res.on("error", () => reject(new HttpError(502, "MedASR response was interrupted.", { code: "MEDASR_NETWORK" })));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { reject(new HttpError(502, "MedASR returned invalid JSON.", { code: "MEDASR_RESPONSE" })); }
        });
      });
      req.on("error", (error) => reject(error instanceof HttpError ? error : new HttpError(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? "MedASR request timed out or was cancelled." : "MedASR server is unreachable.", { code: controller.signal.aborted ? "MEDASR_TIMEOUT" : "MEDASR_NETWORK" })));
      req.end(body);
    });
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export async function checkMedAsrHealth(connection: MedAsrConnection): Promise<{ model: string }> {
  const result = await request({ ...connection, timeoutSeconds: Math.min(connection.timeoutSeconds, 10) }, "/health") as Record<string, unknown> | null;
  if (!result || result.status !== "ready" || typeof result.model !== "string" || !result.model.trim() || result.model.length > 200) throw new HttpError(502, "MedASR is not ready or returned an invalid health response.", { code: "MEDASR_RESPONSE" });
  return { model: result.model };
}

export async function transcribeMedAsr(connection: MedAsrConnection, apiKey: string, audio: DictationAudio, signal?: AbortSignal): Promise<TranscriptionResult> {
  const mime = validateAudio(audio);
  const boundary = `rispro-${crypto.randomUUID()}`;
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dictation.${audioFormats[mime]}"\r\nContent-Type: ${mime}\r\n\r\n`), audio.buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const result = await request(connection, "/transcribe", body, { "Content-Type": `multipart/form-data; boundary=${boundary}`, ...(apiKey ? { "X-API-Key": apiKey } : {}) }, signal) as Record<string, unknown> | null;
  if (!result || typeof result.text !== "string" || typeof result.processing_seconds !== "number" || !Number.isFinite(result.processing_seconds) || result.processing_seconds < 0) throw new HttpError(502, "MedASR returned an invalid transcription response.", { code: "MEDASR_RESPONSE" });
  return { text: result.text, processing_seconds: result.processing_seconds };
}
