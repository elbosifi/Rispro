export const WORKSTATION_NAPS2_SETTINGS_KEY = "rispro.naps2WebScanWorkstation.v1";

export interface WorkstationNaps2Settings {
  version: 1;
  endpoint: string;
  updatedAt: string;
}

export type EffectiveNaps2Endpoint =
  | { endpoint: string; source: "workstation" | "system" }
  | { endpoint: undefined; source: "localhost" };

export function normalizeNaps2Origin(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error("NAPS2 eSCL endpoint is required.");
  if (candidate.includes("*")) throw new Error("NAPS2 eSCL endpoint must be one exact origin without wildcards.");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("NAPS2 eSCL endpoint must be a valid HTTP or HTTPS origin.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("NAPS2 eSCL endpoint must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("NAPS2 eSCL endpoint must not include credentials.");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("NAPS2 eSCL endpoint must be an origin without a path, query, or fragment.");
  return url.origin;
}

export function loadWorkstationNaps2Settings(storage: Storage = window.localStorage): WorkstationNaps2Settings | null {
  try {
    const raw = JSON.parse(storage.getItem(WORKSTATION_NAPS2_SETTINGS_KEY) || "null") as Partial<WorkstationNaps2Settings> | null;
    if (!raw || raw.version !== 1 || typeof raw.endpoint !== "string" || typeof raw.updatedAt !== "string" || Number.isNaN(Date.parse(raw.updatedAt))) return null;
    return { version: 1, endpoint: normalizeNaps2Origin(raw.endpoint), updatedAt: raw.updatedAt };
  } catch {
    return null;
  }
}

export function saveWorkstationNaps2Settings(endpoint: string, storage: Storage = window.localStorage, now = new Date()): WorkstationNaps2Settings {
  const settings: WorkstationNaps2Settings = { version: 1, endpoint: normalizeNaps2Origin(endpoint), updatedAt: now.toISOString() };
  storage.setItem(WORKSTATION_NAPS2_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

export function resetWorkstationNaps2Settings(storage: Storage = window.localStorage): void {
  storage.removeItem(WORKSTATION_NAPS2_SETTINGS_KEY);
}

export function resolveEffectiveNaps2Endpoint(globalEndpoint?: string | null, storage: Storage = window.localStorage): EffectiveNaps2Endpoint {
  const local = loadWorkstationNaps2Settings(storage);
  if (local) return { endpoint: local.endpoint, source: "workstation" };
  const systemEndpoint = globalEndpoint?.trim();
  if (systemEndpoint) return { endpoint: systemEndpoint, source: "system" };
  return { endpoint: undefined, source: "localhost" };
}
