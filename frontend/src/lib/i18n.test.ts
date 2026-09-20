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

    expect(englishKeys).toHaveLength(2893);
    expect(arabicKeys).toEqual(englishKeys);
  });

  it("keeps every translation key and value byte-for-byte stable", () => {
    expect(catalogHash(__i18nTestables.en)).toBe("10d4f028e0fcba3c7aa713f9d85e4d2bfd79f5bebd8c1ded42684a55f0f09546");
    expect(catalogHash(__i18nTestables.ar)).toBe("3e47cfea0fc907b8893f5c253a9b6cea729970f556c3f4bd9da93f6248860eb3");
  });

  it("keeps interpolation placeholders aligned between English and Arabic", () => {
    const placeholders = (value: string) => [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(__i18nTestables.en) as Array<keyof typeof __i18nTestables.en>) {
      expect(placeholders(__i18nTestables.ar[key]), key).toEqual(placeholders(__i18nTestables.en[key]));
    }
  });

  it("preserves interpolation and localized fallback behavior", () => {
    expect(t("en", "globalSearch.resultCount", { count: 3 })).toBe("3 search results");
    expect(chooseLocalized("ar", "", "English fallback")).toBe("English fallback");
    expect(chooseLocalized("en", "بديل عربي", "")).toBe("بديل عربي");
    expect(statusLabel("en", "not-a-status")).toBe("not-a-status");
    expect(t("en", "pacs.remap.recoverSource")).toBe("Recover Source");
    expect(t("ar", "pacs.remap.recoverSource")).toBe("استعادة المصدر");
    expect(t("en", "irReferral.status.readyForReview")).toBe("Ready for review");
    expect(t("ar", "irReferral.status.readyForReview")).toBe("جاهز للمراجعة");
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

    expect(t("en", "settings.section.patient_import")).toBe("Patient Import");
    expect(t("ar", "settings.section.patient_import")).toBe("استيراد المرضى");
    expect(t("en", "reauth.usePasskey")).toBe("Use Passkey");
    expect(t("ar", "reauth.usePasskey")).toBe("استخدم مفتاح المرور");
  });
});
