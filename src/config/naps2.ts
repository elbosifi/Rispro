import { env, parseNaps2WebscanAllowedOrigins } from "./env.js";

// Exact origins only. No database work belongs in response-header middleware.
export function naps2ConnectOrigins(): string[] {
  return [...new Set([
    ...Array.from({ length: 50 }, (_, index) => [
      `http://127.0.0.1:${9801 + index}`,
      `http://localhost:${9801 + index}`,
    ]).flat(),
    ...parseNaps2WebscanAllowedOrigins(env.naps2WebscanEndpoint),
    ...env.naps2WebscanAllowedOrigins,
  ])];
}
