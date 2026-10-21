import { beforeEach, describe, expect, it } from "vitest";
import {
  WORKSTATION_NAPS2_SETTINGS_KEY,
  WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY,
  loadWorkstationNaps2ScanPreferences,
  loadWorkstationNaps2Settings,
  normalizeNaps2Origin,
  resetWorkstationNaps2ScanPreferences,
  resetWorkstationNaps2Settings,
  resolveEffectiveNaps2ScanPreferences,
  resolveEffectiveNaps2Endpoint,
  saveWorkstationNaps2ScanPreferences,
  saveWorkstationNaps2Settings,
} from "./workstation-naps2-settings";

describe("workstation NAPS2 settings", () => {
  beforeEach(() => localStorage.clear());

  it("stores only the versioned canonical origin shape", () => {
    const saved = saveWorkstationNaps2Settings(" https://scanner.example.test:9801/ ", localStorage, new Date("2026-08-06T10:00:00.000Z"));
    expect(saved).toEqual({ version: 1, endpoint: "https://scanner.example.test:9801", updatedAt: "2026-08-06T10:00:00.000Z" });
    expect(JSON.parse(localStorage.getItem(WORKSTATION_NAPS2_SETTINGS_KEY) || "null")).toEqual(saved);
    expect(loadWorkstationNaps2Settings()).toEqual(saved);
  });

  it.each([
    "",
    "ftp://scanner.example.test",
    "http://user:pass@scanner.example.test",
    "http://scanner.example.test/eSCL",
    "http://scanner.example.test/?query=1",
    "http://scanner.example.test/#fragment",
    "http://*.example.test",
    "not a url",
  ])("rejects malformed or non-origin endpoint %s", (endpoint) => {
    expect(() => normalizeNaps2Origin(endpoint)).toThrow();
  });

  it("ignores corrupt stored data", () => {
    localStorage.setItem(WORKSTATION_NAPS2_SETTINGS_KEY, JSON.stringify({ version: 1, endpoint: "http://scanner/eSCL", updatedAt: "bad" }));
    expect(loadWorkstationNaps2Settings()).toBeNull();
  });

  it("resolves workstation then system then automatic localhost", () => {
    expect(resolveEffectiveNaps2Endpoint("http://global:9801")).toEqual({ endpoint: "http://global:9801", source: "system" });
    saveWorkstationNaps2Settings("http://local:9801");
    expect(resolveEffectiveNaps2Endpoint("http://global:9801")).toEqual({ endpoint: "http://local:9801", source: "workstation" });
    resetWorkstationNaps2Settings();
    expect(resolveEffectiveNaps2Endpoint("")).toEqual({ endpoint: undefined, source: "localhost" });
  });

  it("reset removes the workstation override", () => {
    saveWorkstationNaps2Settings("http://scanner:9801");
    resetWorkstationNaps2Settings();
    expect(localStorage.getItem(WORKSTATION_NAPS2_SETTINGS_KEY)).toBeNull();
  });

  it("saves and reloads only validated scan preference overrides", () => {
    const saved = saveWorkstationNaps2ScanPreferences(
      { source: "flatbed", dpi: 1200, colorMode: "color" },
      localStorage,
      new Date("2026-08-06T10:00:00.000Z"),
    );
    expect(saved).toEqual({
      version: 1,
      overrides: { source: "flatbed", dpi: 1200, colorMode: "color" },
      updatedAt: "2026-08-06T10:00:00.000Z",
    });
    expect(JSON.parse(localStorage.getItem(WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY) || "null")).toEqual(saved);
    expect(loadWorkstationNaps2ScanPreferences()).toEqual(saved);
  });

  it("ignores invalid stored fields independently and inherits system values", () => {
    localStorage.setItem(WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY, JSON.stringify({
      version: 1,
      overrides: { source: "not-a-source", dpi: 50, colorMode: "sepia" },
      updatedAt: "2026-08-06T10:00:00.000Z",
    }));
    expect(loadWorkstationNaps2ScanPreferences()?.overrides).toEqual({ dpi: 50 });
    expect(resolveEffectiveNaps2ScanPreferences({ source: "auto", dpi: "400", colorMode: "color" })).toEqual({
      source: "auto", dpi: 50, colorMode: "color",
    });
  });

  it("resolves global defaults when there are no workstation or one-time overrides", () => {
    expect(resolveEffectiveNaps2ScanPreferences({ source: "auto", dpi: "300", colorMode: "color" })).toEqual({
      source: "auto", dpi: 300, colorMode: "color",
    });
    expect(resolveEffectiveNaps2ScanPreferences({ source: "unknown", dpi: "1201", colorMode: "unknown" })).toEqual({
      source: "feeder", dpi: 200, colorMode: "grayscale",
    });
  });

  it("applies workstation and one-time overrides independently by field", () => {
    saveWorkstationNaps2ScanPreferences({ source: "flatbed", dpi: 300 });
    expect(resolveEffectiveNaps2ScanPreferences({ source: "auto", dpi: "200", colorMode: "grayscale" })).toEqual({
      source: "flatbed", dpi: 300, colorMode: "grayscale",
    });
    expect(resolveEffectiveNaps2ScanPreferences(
      { source: "auto", dpi: "200", colorMode: "grayscale" },
      { source: "feeder", dpi: 200 },
    )).toEqual({ source: "feeder", dpi: 200, colorMode: "grayscale" });
  });

  it("uses changed global values for fields that remain inherited", () => {
    saveWorkstationNaps2ScanPreferences({ source: "flatbed" });
    expect(resolveEffectiveNaps2ScanPreferences({ source: "auto", dpi: "400", colorMode: "color" })).toEqual({
      source: "flatbed", dpi: 400, colorMode: "color",
    });
  });

  it("resets scan preferences separately from the scanner endpoint override", () => {
    saveWorkstationNaps2Settings("http://scanner:9801");
    saveWorkstationNaps2ScanPreferences({ dpi: 600 });
    resetWorkstationNaps2ScanPreferences();
    expect(localStorage.getItem(WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY)).toBeNull();
    expect(loadWorkstationNaps2Settings()?.endpoint).toBe("http://scanner:9801");

    saveWorkstationNaps2ScanPreferences({ source: "duplex" });
    resetWorkstationNaps2Settings();
    expect(loadWorkstationNaps2ScanPreferences()?.overrides).toEqual({ source: "duplex" });
  });

  it("fails safely for corrupted or unavailable storage and reports save failures", () => {
    localStorage.setItem(WORKSTATION_NAPS2_SCAN_PREFERENCES_KEY, "not-json");
    expect(loadWorkstationNaps2ScanPreferences()).toBeNull();
    const unavailable = {
      getItem: () => { throw new Error("storage blocked"); },
      setItem: () => { throw new Error("storage blocked"); },
      removeItem: () => { throw new Error("storage blocked"); },
    } as unknown as Storage;
    expect(loadWorkstationNaps2ScanPreferences(unavailable)).toBeNull();
    expect(() => saveWorkstationNaps2ScanPreferences({ dpi: 300 }, unavailable)).toThrow("storage blocked");
    expect(() => resetWorkstationNaps2ScanPreferences(unavailable)).toThrow("storage blocked");
    expect(resolveEffectiveNaps2ScanPreferences({ source: "feeder", dpi: 200, colorMode: "grayscale" }, {}, {}, unavailable)).toBeDefined();
  });
});
