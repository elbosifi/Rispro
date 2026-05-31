import { normalizeArabicName, normalizeArabicNameCompact } from "./normalize.js";

export interface NameDictionaryLookup {
  arabic_text: string;
  english_text: string;
}

export interface NameGenerationResult {
  englishName: string;
  missingTokens: string[];
}

export function generateEnglishFromDictionary(
  arabicFullName: string,
  dictionary: NameDictionaryLookup[]
): NameGenerationResult {
  const input = String(arabicFullName || "").trim();
  if (!input) return { englishName: "", missingTokens: [] };

  const tokens = input.split(/\s+/);
  const normalizedDict = new Map<string, string>();

  for (const entry of dictionary) {
    const normalizedKey = normalizeArabicName(entry.arabic_text);
    const compactKey = normalizeArabicNameCompact(entry.arabic_text);

    normalizedDict.set(normalizedKey, entry.english_text);
    normalizedDict.set(compactKey, entry.english_text);
  }

  const englishParts: string[] = [];
  const missingTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const twoTokenPhrase = tokens.slice(index, index + 2).join(" ");
    const phraseMatch = normalizedDict.get(normalizeArabicName(twoTokenPhrase))
      || normalizedDict.get(normalizeArabicNameCompact(twoTokenPhrase));

    if (phraseMatch) {
      englishParts.push(phraseMatch);
      index += 1;
      continue;
    }

    const token = tokens[index] || "";
    const englishMatch = normalizedDict.get(normalizeArabicName(token))
      || normalizedDict.get(normalizeArabicNameCompact(token));

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
