import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

const { DEFAULT_SONICDICOM_REPORT_SETTINGS, normalizeSonicDicomReportSettings, validateSonicDicomReportSettings } = await import("./sonicdicom-report-settings.js");
const { isLocalSonicDicomRequestHostname, resolveSonicDicomBrowserBaseUrl } = await import("./sonicdicom-browser-url.js");

const settings = {
  ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
  sonicDicomPublicBaseUrl: "https://public-sonic.example/viewer",
  sonicDicomLocalBaseUrl: "http://192.168.1.30:8080/viewer",
};

describe("SonicDICOM request hostname classification", () => {
  for (const hostname of ["192.168.1.20", "10.0.0.20", "172.16.0.20", "172.31.255.20", "127.0.0.1", "localhost", "::1", "[::1]", "2001:db8::20", "172.15.0.20", "172.32.0.20"]) {
    it(`classifies ${hostname} as local/IP access`, () => {
      assert.equal(isLocalSonicDicomRequestHostname(hostname), true);
    });
  }

  for (const hostname of ["rispro.example.com", "ris.nccb.com.ly", "rispro-192-168-1-20.example.com"]) {
    it(`classifies ${hostname} as public/domain access`, () => {
      assert.equal(isLocalSonicDicomRequestHostname(hostname), false);
    });
  }
});

describe("SonicDICOM browser base URL selection", () => {
  it("selects local for an IP request", () => {
    assert.equal(resolveSonicDicomBrowserBaseUrl("192.168.1.20", settings), "http://192.168.1.30:8080/viewer");
  });

  it("selects public for a domain request", () => {
    assert.equal(resolveSonicDicomBrowserBaseUrl("rispro.example.com", settings), "https://public-sonic.example/viewer");
  });

  it("falls back to public when local is empty", () => {
    assert.equal(resolveSonicDicomBrowserBaseUrl("10.0.0.20", { ...settings, sonicDicomLocalBaseUrl: "" }), "https://public-sonic.example/viewer");
  });

  it("fails controllably for malformed selected local URL", () => {
    assert.throws(
      () => resolveSonicDicomBrowserBaseUrl("10.0.0.20", { ...settings, sonicDicomLocalBaseUrl: "javascript:alert(1)" }),
      /Local SonicDICOM browser URL is malformed/
    );
  });

  it("fails controllably for malformed selected public URL", () => {
    assert.throws(
      () => resolveSonicDicomBrowserBaseUrl("rispro.example.com", { ...settings, sonicDicomPublicBaseUrl: "not a url" }),
      /Public SonicDICOM browser URL is malformed/
    );
  });

  it("does not use a malicious request hostname as the destination", () => {
    assert.equal(resolveSonicDicomBrowserBaseUrl("evil.example", settings), "https://public-sonic.example/viewer");
  });
});

describe("SonicDICOM browser settings", () => {
  it("keeps existing configurations without a local URL backward compatible", () => {
    assert.equal(normalizeSonicDicomReportSettings({ sonicDicomPublicBaseUrl: "https://public.example/viewer" }).sonicDicomLocalBaseUrl, "");
  });

  it("accepts supported local browser URL forms and an empty fallback", () => {
    for (const localUrl of ["", "http://192.168.1.30/viewer", "https://192.168.1.30/viewer", "http://192.168.1.30:8080/viewer", "http://sonicdicom.local/viewer"]) {
      assert.equal(validateSonicDicomReportSettings({ ...settings, sonicDicomLocalBaseUrl: localUrl }).sonicDicomLocalBaseUrl, localUrl);
    }
  });

  it("rejects malformed and non-HTTP browser URLs", () => {
    assert.throws(() => validateSonicDicomReportSettings({ ...settings, sonicDicomLocalBaseUrl: "ftp://sonic.local/viewer" }), /valid HTTP or HTTPS URL/);
    assert.throws(() => validateSonicDicomReportSettings({ ...settings, sonicDicomPublicBaseUrl: "not a url" }), /valid HTTP or HTTPS URL/);
  });
});
