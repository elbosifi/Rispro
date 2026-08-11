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

    expect(englishKeys).toHaveLength(1998);
    expect(arabicKeys).toEqual(englishKeys);
  });

  it("keeps every translation key and value byte-for-byte stable", () => {
    expect(catalogHash(__i18nTestables.en)).toBe("a807edd0e12a2236da7e2cf8a71cb762f35d4f8eec2a544b892818f44d71ec97");
    expect(catalogHash(__i18nTestables.ar)).toBe("08a605b7b4a82a956a4434d644f81b4acb39be703c6c1ad243113000a410dea4");
  });

  it("preserves interpolation and localized fallback behavior", () => {
    expect(t("en", "globalSearch.resultCount", { count: 3 })).toBe("3 search results");
    expect(chooseLocalized("ar", "", "English fallback")).toBe("English fallback");
    expect(chooseLocalized("en", "بديل عربي", "")).toBe("بديل عربي");
    expect(statusLabel("en", "not-a-status")).toBe("not-a-status");
  });
});
