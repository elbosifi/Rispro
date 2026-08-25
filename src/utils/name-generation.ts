import { normalizeArabicName, normalizeArabicNameCompact } from "./normalize.js";

export interface NameDictionaryLookup {
  arabic_text: string;
  english_text: string;
}

export interface NameGenerationResult {
  englishName: string;
  missingTokens: string[];
}

export type CompiledNameDictionaryLookup = Map<string, string>;

export function buildNameDictionaryLookup(dictionary: NameDictionaryLookup[]): CompiledNameDictionaryLookup {
  const lookup = new Map<string, string>();

  for (const entry of dictionary) {
    const normalizedKey = normalizeArabicName(entry.arabic_text);
    const compactKey = normalizeArabicNameCompact(entry.arabic_text);

    lookup.set(normalizedKey, entry.english_text);
    lookup.set(compactKey, entry.english_text);
  }

  return lookup;
}

export function generateEnglishFromDictionaryLookup(
  arabicFullName: string,
  lookup: CompiledNameDictionaryLookup
): NameGenerationResult {
  const input = String(arabicFullName || "").trim();
  if (!input) return { englishName: "", missingTokens: [] };

  const tokens = input.split(/\s+/);
  const englishParts: string[] = [];
  const missingTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const twoTokenPhrase = tokens.slice(index, index + 2).join(" ");
    const phraseMatch = lookup.get(normalizeArabicName(twoTokenPhrase))
      || lookup.get(normalizeArabicNameCompact(twoTokenPhrase));

    if (phraseMatch) {
      englishParts.push(phraseMatch);
      index += 1;
      continue;
    }

    const token = tokens[index] || "";
    const englishMatch = lookup.get(normalizeArabicName(token))
      || lookup.get(normalizeArabicNameCompact(token));

    if (englishMatch) {
      englishParts.push(englishMatch);
    } else {
      missingTokens.push(token);
    }
  }

  return {
    englishName: englishParts.join(" "),
    missingTokens
  };
}

export function generateEnglishFromDictionary(
  arabicFullName: string,
  dictionary: NameDictionaryLookup[]
): NameGenerationResult {
  return generateEnglishFromDictionaryLookup(arabicFullName, buildNameDictionaryLookup(dictionary));
}
