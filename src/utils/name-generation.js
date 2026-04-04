// @ts-check

/**
 * Dictionary-based Arabic-to-English name generation (backend version).
 * Mirrors frontend/src/lib/name-generation.ts.
 */

/**
 * @typedef {object} NameDictionaryLookup
 * @property {string} arabic_text
 * @property {string} english_text
 */

/**
 * @typedef {object} NameGenerationResult
 * @property {string} englishName
 * @property {string[]} missingTokens
 */

/**
 * Normalize Arabic text for dictionary matching.
 * @param {string} text
 * @returns {string}
 */
function normalizeArabicToken(text) {
  return text
    .trim()
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\s+/g, " ");
}

/**
 * Generate an English name from an Arabic full name using dictionary entries.
 *
 * @param {string} arabicFullName
 * @param {NameDictionaryLookup[]} dictionary
 * @returns {NameGenerationResult}
 */
export function generateEnglishFromDictionary(arabicFullName, dictionary) {
  const input = String(arabicFullName || "").trim();
  if (!input) return { englishName: "", missingTokens: [] };

  const tokens = input.split(/\s+/);
  /** @type {Map<string, string>} */
  const normalizedDict = new Map();

  for (const entry of dictionary) {
    const normalizedKey = normalizeArabicToken(entry.arabic_text);
    normalizedDict.set(normalizedKey, entry.english_text);
  }

  /** @type {string[]} */
  const englishParts = [];
  /** @type {string[]} */
  const missingTokens = [];

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
