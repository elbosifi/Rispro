/**
 * Dictionary-based Arabic-to-English name generation.
 * Splits an Arabic full name into tokens and looks each token up
 * in the provided name dictionary. Returns the generated English name
 * and a list of tokens that were not found in the dictionary.
 */

export interface DictionaryEntry {
  arabicText: string;
  englishText: string;
}

export interface NameGenerationResult {
  englishName: string;
  missingTokens: string[];
}

/**
 * Normalize Arabic text for dictionary matching.
 * Collides common variant characters so that lookups are forgiving.
 */
function normalizeArabicToken(text: string): string {
  return text
    .trim()
    .replace(/[\u0623\u0625\u0622]/g, "\u0627") // أ إ آ → ا
    .replace(/\u0629/g, "\u0647")               // ة → ه
    .replace(/\u0649/g, "\u064A")               // ى → ي
    .replace(/\u0624/g, "\u0648")               // ؤ → و
    .replace(/\u0626/g, "\u064A")               // ئ → ي
    .replace(/\s+/g, " ");
}

/**
 * Generate an English name from an Arabic full name using a dictionary.
 *
 * @param arabicFullName - The Arabic full name as entered by the user
 * @param dictionary - Array of dictionary entries from the settings API
 * @returns The generated English name and any tokens not found in the dictionary
 */
export function generateEnglishFromDictionary(
  arabicFullName: string,
  dictionary: DictionaryEntry[]
): NameGenerationResult {
  const input = String(arabicFullName || "").trim();
  if (!input) return { englishName: "", missingTokens: [] };

  const tokens = input.split(/\s+/);
  const normalizedDict = new Map<string, string>();

  for (const entry of dictionary) {
    const normalizedKey = normalizeArabicToken(entry.arabicText);
    normalizedDict.set(normalizedKey, entry.englishText);
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
