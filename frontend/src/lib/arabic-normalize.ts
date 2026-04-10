/**
 * Arabic text normalization for tolerant search matching.
 * Mirrors the backend logic in src/utils/arabic-normalize.ts.
 *
 * Rules applied (in order):
 *  1. Remove diacritics (tashkeel)
 *  2. Remove tatweel (kashida)
 *  3. Normalize hamza variants on alif:  أ / إ / آ  ->  ا
 *  4. Normalize ى (alif maqsura) -> ي
 *  5. Normalize  ة (ta marbuta) -> ه
 *  6. Trim and collapse whitespace
 */

export function normalizeArabic(text: string): string {
  return (
    text
      // 1. Remove diacritics
      .replace(/[\u064B-\u0652\u0654-\u0655\u0670]/g, "")
      // 2. Remove tatweel
      .replace(/\u0640/g, "")
      // 3. Normalize hamza on alif
      .replace(/[\u0622\u0623\u0625]/g, "\u0627") // آ أ إ -> ا
      // 4. Alif maqsura -> ya
      .replace(/\u0649/g, "\u064A") // ى -> ي
      // 5. Ta marbuta -> ha
      .replace(/\u0629/g, "\u0647") // ة -> ه
      // 6. Trim and collapse whitespace
      .trim()
      .replace(/\s+/g, " ")
  );
}
