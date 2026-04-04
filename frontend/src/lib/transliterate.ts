/**
 * Deterministic Arabic-to-Latin transliteration for patient names (frontend version).
 * Mirrors src/utils/transliterate.js.
 */

const CHAR_MAP = new Map<string, string>([
  ['\u0627', 'a'],  // ا
  ['\u0622', 'aa'], // آ
  ['\u0623', 'a'],  // أ
  ['\u0625', 'e'],  // إ
  ['\u0628', 'b'],  // ب
  ['\u062a', 't'],  // ت
  ['\u062b', 'th'], // ث
  ['\u062c', 'j'],  // ج
  ['\u062d', 'h'],  // ح
  ['\u062e', 'kh'], // خ
  ['\u062f', 'd'],  // د
  ['\u0630', 'dh'], // ذ
  ['\u0631', 'r'],  // ر
  ['\u0632', 'z'],  // ز
  ['\u0633', 's'],  // س
  ['\u0634', 'sh'], // ش
  ['\u0635', 's'],  // ص
  ['\u0636', 'd'],  // ض
  ['\u0637', 't'],  // ط
  ['\u0638', 'z'],  // ظ
  ['\u0639', 'a'],  // ع
  ['\u063a', 'gh'], // غ
  ['\u0641', 'f'],  // ف
  ['\u0642', 'q'],  // ق
  ['\u0643', 'k'],  // ك
  ['\u0644', 'l'],  // ل
  ['\u0645', 'm'],  // م
  ['\u0646', 'n'],  // ن
  ['\u0647', 'h'],  // ه
  ['\u0648', 'w'],  // و
  ['\u064a', 'y'],  // ي
  ['\u0649', 'a'],  // ى
  ['\u0629', 'a'],  // ة
  ['\u0624', 'w'],  // ؤ
  ['\u0626', 'y'],  // ئ
  ['\u0651', ''],   // ّ (shadda)
  ['\u064e', 'a'],  // َ (fatha)
  ['\u0650', 'i'],  // ِ (kasra)
  ['\u064f', 'u'],  // ُ (damma)
  ['\u0652', ''],   // ْ (sukun)
  ['\u064b', 'an'], // ً
  ['\u064d', 'in'], // ٍ
  ['\u064c', 'un'], // ٌ
]);

export function transliterateArabicName(arabicName: string): string {
  const input = String(arabicName || '').trim();
  if (!input) return '';

  let result = '';
  const chars = [...input];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const mapping = CHAR_MAP.get(ch);

    if (mapping === undefined) {
      if (ch === ' ' || /[a-zA-Z]/.test(ch)) {
        result += ch;
      }
    } else if (mapping === '') {
      if (ch === '\u0651' && result.length > 0) {
        const lastChar = result[result.length - 1];
        if (/[a-zA-Z]/.test(lastChar)) {
          result += lastChar;
        }
      }
    } else {
      result += mapping;
    }
  }

  return result.replace(/\s+/g, ' ').trim();
}
