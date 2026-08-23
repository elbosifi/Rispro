import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  __i18nTestables,
  chooseLocalized,
  statusLabel,
  t,
} from "./i18n";

function catalogHash(catalog: Record<string, string>): string {
  const entries = Object.entries(catalog).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

describe("i18n catalog parity", () => {
  it("keeps the complete English and Arabic key sets aligned", () => {
    const englishKeys = Object.keys(__i18nTestables.en).sort();
    const arabicKeys = Object.keys(__i18nTestables.ar).sort();

    expect(englishKeys).toHaveLength(2273);
    expect(arabicKeys).toEqual(englishKeys);
  });

  it("keeps every translation key and value byte-for-byte stable", () => {
    expect(catalogHash(__i18nTestables.en)).toBe("828cf5f74e620284d2ae5d09071f1eef2e37657a9cf307bcfcb6a4d9be9d15f7");
    expect(catalogHash(__i18nTestables.ar)).toBe("fcb43f90ea5b5c9ce1e40bf7fad1e239670b383f5cc2f63de7435b39ebc35884");
  });

  it("preserves interpolation and localized fallback behavior", () => {
    expect(t("en", "globalSearch.resultCount", { count: 3 })).toBe("3 search results");
    expect(chooseLocalized("ar", "", "English fallback")).toBe("English fallback");
    expect(chooseLocalized("en", "بديل عربي", "")).toBe("بديل عربي");
    expect(statusLabel("en", "not-a-status")).toBe("not-a-status");
  });

  it("provides English and Arabic copy for the request-document protocol policy", () => {
    const keys = [
      "settings.documents.requireRequestForProtocolQueue",
      "settings.documents.requireRequestForProtocolQueueHelp",
      "doctor.protocols.requestDocumentPolicyNotice",
      "documents.protocolRequestAttached",
      "documents.protocolRequestMissing",
    ] as const;

    for (const key of keys) {
      expect(t("en", key)).not.toBe(key);
      expect(t("ar", key)).not.toBe(key);
      expect(t("ar", key)).not.toBe(t("en", key));
    }
  });

  it("provides English and Arabic copy for the MWL protocol policy", () => {
    const keys = [
      "settings.section.mwl_policy",
      "settings.mwlPolicy.requireProtocol",
      "settings.mwlPolicy.requireProtocolHelp",
      "settings.mwlPolicy.saved",
      "settings.mwlPolicy.saveFailed",
      "worklistMonitor.waitingForProtocol",
    ] as const;

    for (const key of keys) {
      expect(t("en", key)).not.toBe(key);
      expect(t("ar", key)).not.toBe(key);
      expect(t("ar", key)).not.toBe(t("en", key));
    }
  });
});
