export interface NameDictionaryLookup {
  arabic_text: string;
  english_text: string;
}

export interface NameGenerationResult {
  englishName: string;
  missingTokens: string[];
}

function normalizeArabicToken(text: string): string {
  return text
    .trim()
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\s+/g, " ");
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
    const normalizedKey = normalizeArabicToken(entry.arabic_text);
    normalizedDict.set(normalizedKey, entry.english_text);
  }

  const englishParts: string[] = [];
  const missingTokens: string[] = [];

  for (const token of tokens) {
    const normalizedToken = normalizeArabicToken(token);
    const englishMatch = normalizedDict.get(normalizedToken);

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
