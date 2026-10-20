import { env, parseNaps2WebscanAllowedOrigins } from "./env.js";

let savedConnectOrigins: string[] | null = null;

export function configuredNaps2Endpoint(settings: Record<string, string>): string {
  return (settings.naps2_webscan_endpoint ?? env.naps2WebscanEndpoint).trim();
}

export function configuredNaps2Enabled(settings: Record<string, string>): boolean {
  return settings.naps2_webscan_enabled === undefined ? env.naps2WebscanEnabled : settings.naps2_webscan_enabled.trim().toLowerCase() === "enabled";
}

// Called at startup and after a committed Settings save. Headers use memory only.
export function configureNaps2ConnectOrigins(settings: Record<string, string>): void {
  savedConnectOrigins = [
    ...parseNaps2WebscanAllowedOrigins(configuredNaps2Endpoint(settings)),
    ...(settings.naps2_webscan_allowed_origins === undefined ? env.naps2WebscanAllowedOrigins : parseNaps2WebscanAllowedOrigins(settings.naps2_webscan_allowed_origins)),
  ];
}

export function naps2ConnectOrigins(): string[] {
  return [...new Set([
    ...Array.from({ length: 50 }, (_, index) => [
      `http://127.0.0.1:${9801 + index}`,
      `http://localhost:${9801 + index}`,
    ]).flat(),
    ...(savedConnectOrigins ?? [...parseNaps2WebscanAllowedOrigins(env.naps2WebscanEndpoint), ...env.naps2WebscanAllowedOrigins]),
  ])];
}
