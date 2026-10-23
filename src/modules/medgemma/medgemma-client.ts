import http from "node:http";
import https from "node:https";
import { HttpError } from "../../utils/http-error.js";
import { CLEANUP_DICTATION_INSTRUCTIONS } from "./cleanup-instructions.js";
import type { MedGemmaTask } from "./task-instructions.js";

export interface MedGemmaConnection { baseUrl: string; timeoutSeconds: number; allowInsecureHttp: boolean }
export interface MedGemmaResult { text: string; processing_seconds: number }
export interface MedGemmaGeneration { task: MedGemmaTask; text: string; instructions: string; temperature: number; maxGeneratedTokens: number }
export const MAX_TEXT_LENGTH = 32_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export function validateMedGemmaUrl(connection: MedGemmaConnection): string {
  let url: URL;
  try { url = new URL(connection.baseUrl); }
  catch { throw new HttpError(400, "Enter a valid MedGemma server URL."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new HttpError(400, "MedGemma URL must be an HTTP(S) origin without credentials, path, query or fragment.");
  }
  if (url.protocol === "http:" && !connection.allowInsecureHttp) throw new HttpError(400, "Acknowledge unencrypted HTTP before using this MedGemma URL.");
  return url.origin;
}

export function validateDictationText(text: unknown): asserts text is string {
  if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Non-empty original dictation text is required.");
  if (text.length > MAX_TEXT_LENGTH) throw new HttpError(413, "Dictation exceeds the 32,000 character limit.");
}

// Node HTTP does not follow redirects or use proxy environment variables.
// Errors deliberately exclude upstream bodies, submitted text and credentials.
async function request(connection: MedGemmaConnection, path: "/health" | "/generate", apiKey: string, body?: Buffer, signal?: AbortSignal): Promise<unknown> {
  const url = new URL(path, validateMedGemmaUrl(connection));
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, connection.timeoutSeconds * 1000);
  try {
    return await new Promise((resolve, reject) => {
      const req = (url.protocol === "https:" ? https : http).request(url, {
        method: body ? "POST" : "GET", signal: controller.signal, agent: false,
        headers: { Accept: "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}), ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}) },
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          res.destroy();
          reject(new HttpError(502, status === 401 || status === 403 ? "MedGemma rejected authentication. Check the saved API key." : status >= 300 && status < 400 ? "MedGemma redirects are not permitted." : "MedGemma returned an unsuccessful response."));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) { reject(new HttpError(502, "MedGemma response is too large.")); res.destroy(); }
          else chunks.push(chunk);
        });
        res.on("error", () => reject(new HttpError(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? "MedGemma request timed out or was cancelled." : "MedGemma response was interrupted.")));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { reject(new HttpError(502, "MedGemma returned invalid JSON.")); }
        });
      });
      req.on("error", () => reject(new HttpError(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? "MedGemma request timed out or was cancelled." : "MedGemma server is unreachable.")));
      req.end(body);
    });
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export async function checkMedGemmaHealth(connection: MedGemmaConnection, apiKey: string): Promise<{ model: string }> {
  const result = await request({ ...connection, timeoutSeconds: Math.min(connection.timeoutSeconds, 10) }, "/health", apiKey) as Record<string, unknown> | null;
  if (!result || result.status !== "ready" || typeof result.model !== "string" || !result.model.trim() || result.model.length > 200) throw new HttpError(502, "MedGemma is not ready or returned an invalid health response.");
  return { model: result.model };
}

export async function cleanupMedGemmaDictation(connection: MedGemmaConnection, apiKey: string, text: string, signal?: AbortSignal): Promise<MedGemmaResult> {
  return generateMedGemma(connection, apiKey, { task: "cleanup_dictation", text, instructions: CLEANUP_DICTATION_INSTRUCTIONS, temperature: 0.1, maxGeneratedTokens: 2048 }, signal);
}

export async function generateMedGemma(connection: MedGemmaConnection, apiKey: string, input: MedGemmaGeneration, signal?: AbortSignal): Promise<MedGemmaResult> {
  validateDictationText(input.text);
  const body = Buffer.from(JSON.stringify({ task: input.task, text: input.text, instructions: input.instructions, temperature: input.temperature, max_new_tokens: input.maxGeneratedTokens }));
  const result = await request(connection, "/generate", apiKey, body, signal) as Record<string, unknown> | null;
  if (!result || typeof result.text !== "string" || !result.text.trim() || result.text.length > MAX_TEXT_LENGTH || typeof result.processing_seconds !== "number" || !Number.isFinite(result.processing_seconds) || result.processing_seconds < 0) throw new HttpError(502, "MedGemma returned an invalid generation response.");
  return { text: result.text, processing_seconds: result.processing_seconds };
}
