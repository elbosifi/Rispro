import { beforeEach, describe, expect, it } from "vitest";
import {
  WORKSTATION_NAPS2_SETTINGS_KEY,
  loadWorkstationNaps2Settings,
  normalizeNaps2Origin,
  resetWorkstationNaps2Settings,
  resolveEffectiveNaps2Endpoint,
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
});
