const CHAR_MAP = new Map<string, string>([
  // Alif variants
  ['\u0627', 'a'],  // ا
  ['\u0622', 'aa'], // آ
  ['\u0623', 'a'],  // أ
  ['\u0625', 'e'],  // إ
  // Ba
  ['\u0628', 'b'],  // ب
  // Ta
  ['\u062a', 't'],  // ت
  // Tha
  ['\u062b', 'th'], // ث
  // Jim
  ['\u062c', 'j'],  // ج
  // Ha
  ['\u062d', 'h'],  // ح
  // Kha
  ['\u062e', 'kh'], // خ
  // Dal
  ['\u062f', 'd'],  // د
  // Dhal
  ['\u0630', 'dh'], // ذ
  // Ra
  ['\u0631', 'r'],  // ر
  // Zayn
  ['\u0632', 'z'],  // ز
  // Sin
  ['\u0633', 's'],  // س
  // Shin
  ['\u0634', 'sh'], // ش
  // Sad
  ['\u0635', 's'],  // ص
  // Dad
  ['\u0636', 'd'],  // ض
  // Ta (emphatic)
  ['\u0637', 't'],  // ط
  // Za (emphatic)
  ['\u0638', 'z'],  // ظ
  // Ayn
  ['\u0639', 'a'],  // ع
  // Ghayn
  ['\u063a', 'gh'], // غ
  // Fa
  ['\u0641', 'f'],  // ف
  // Qaf
  ['\u0642', 'q'],  // ق
  // Kaf
  ['\u0643', 'k'],  // ك
  // Lam
  ['\u0644', 'l'],  // ل
  // Mim
  ['\u0645', 'm'],  // م
  // Nun
  ['\u0646', 'n'],  // ن
  // Ha (soft)
  ['\u0647', 'h'],  // ه
  // Waw
  ['\u0648', 'w'],  // و
  // Ya
  ['\u064a', 'y'],  // ي
  ['\u0649', 'a'],  // ى (alif maqsura)
  // Ta marbuta
  ['\u0629', 'a'],  // ة
  // Hamza on various carriers
  ['\u0624', 'w'],  // ؤ
  ['\u0626', 'y'],  // ئ
  // Shadda (double consonant marker) - we double the preceding letter
  ['\u0651', ''],   // ّ
  // Fatha
  ['\u064e', 'a'],  // َ
  // Kasra
  ['\u0650', 'i'],  // ِ
  // Damma
  ['\u064f', 'u'],  // ُ
  // Sukun
  ['\u0652', ''],   // ْ
  // Fatḥatan
  ['\u064b', 'an'], // ً
  // Kasratan
  ['\u064d', 'in'], // ٍ
  // Dammatan
  ['\u064c', 'un'], // ٌ
]);

export function transliterateArabicName(arabicName: string): string {
  const input = String(arabicName || '').trim();
  if (!input) return '';

  let result = '';
  const chars = [...input]; // Use spread for proper Unicode surrogate handling

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const mapping = CHAR_MAP.get(ch);

    if (mapping === undefined) {
      // Pass through spaces and Latin characters as-is
      if (ch === ' ' || /[a-zA-Z]/.test(ch)) {
        result += ch;
      }
      // Skip unknown diacritics/symbols
    } else if (mapping === '') {
      // Shadda: double the previous Latin character
      if (ch === '\u0651' && result.length > 0) {
        const lastChar = result[result.length - 1];
        if (/[a-zA-Z]/.test(lastChar)) {
          result += lastChar;
        }
      }
      // Sukun: just skip (no vowel)
    } else {
      result += mapping;
    }
  }

  // Clean up: collapse multiple spaces, trim
  return result.replace(/\s+/g, ' ').trim();
}
