import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { env } from "../config/env.js";
import { renderNaps2WindowsSetup, validateNaps2SetupOrigin } from "./scanner-bootstrap-service.js";

describe("NAPS2 workstation download", () => {
  it("renders one self-contained HTTP setup without QZ or remote payload downloads", () => {
    const script = renderNaps2WindowsSetup({ origin: "http://192.9.101.30:8080", endpoint: "" });
    const encoded = script.match(/FromBase64String\('([^']+)'\)/)![1];
    assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64").toString()), { origin: "http://192.9.101.30:8080", endpoint: "", sources: [] });
    assert.doesNotMatch(script, /Invoke-WebRequest|DownloadString|DownloadFile|Stop-Process|taskkill|printing-bootstrap|qz-installer/i);
    assert.match(script, /ServerAllowAnyOrigin/);
    assert.match(script, /LocalNetworkAccessAllowedForUrls/);
    assert.match(script, /RESULT: Ready/);
    assert.match(script, /RESULT: Action required/);
    assert.match(script, /RESULT: Failed/);
    assert.equal(script.includes("__RISPRO_"), false);
    assert.equal(script.replaceAll("\r\n", "").includes("\n"), false);
  });
  it("requires an explicit exact IPv4 HTTP origin", () => {
    assert.equal(validateNaps2SetupOrigin("http://192.9.101.30:8080/"), "http://192.9.101.30:8080");
    for (const value of ["", "https://192.9.101.30", "http://rispro", "http://127.0.0.1", "http://0.0.0.0", "http://224.0.0.1", "http://192.010.101.30", "http://192.9.101.30/path", "http://192.9.101.30?q=x", "http://user@192.9.101.30", "http://192.9.*", "http://192.9.101.30\r\necho unsafe", "http://192.9.101.30:99999"]) {
      assert.throws(() => validateNaps2SetupOrigin(value), Error, value);
    }
  });
  it("rejects unapproved remote scanners and unrestricted firewall sources", () => {
    const old = env.naps2WebscanAllowedOrigins;
    env.naps2WebscanAllowedOrigins = ["http://192.9.101.40:9828"];
    try {
      assert.throws(() => renderNaps2WindowsSetup({ origin: "http://192.9.101.30", endpoint: "http://192.9.101.41:9828" }), /CSP/);
      const setup = renderNaps2WindowsSetup({ origin: "http://192.9.101.30", endpoint: "http://192.9.101.40:9828", sources: "192.9.101.12,192.9.102.0/24" });
      assert.match(setup, /-RemoteAddress \$Sources -Profile Domain,Private/);
      for (const sources of ["*", "Any", "LocalSubnet", "0.0.0.0/0", "192.9.0.0/8", "192.9.1.1;whoami"]) assert.throws(() => renderNaps2WindowsSetup({ origin: "http://192.9.101.30", endpoint: "", sources }), /approved IPv4/);
    } finally { env.naps2WebscanAllowedOrigins = old; }
  });
});
