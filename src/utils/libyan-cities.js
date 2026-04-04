// @ts-check

/**
 * Libyan cities list for address dropdown.
 * Each entry has Arabic and English names.
 * Ordered roughly by population/importance.
 * Ready for future "most-used" sorting.
 */

/**
 * @typedef LibyanCity
 * @property {string} code - unique identifier
 * @property {string} nameAr - Arabic name
 * @property {string} nameEn - English name
 */

/** @type {LibyanCity[]} */
export const LIBYAN_CITIES = [
  { code: 'tripoli', nameAr: 'طرابلس', nameEn: 'Tripoli' },
  { code: 'benghazi', nameAr: 'بنغازي', nameEn: 'Benghazi' },
  { code: 'misrata', nameAr: 'مصراتة', nameEn: 'Misrata' },
  { code: 'bayda', nameAr: 'البيضاء', nameEn: 'Al Bayda' },
  { code: 'zawiya', nameAr: 'الزاوية', nameEn: 'Zawiya' },
  { code: 'zintan', nameAr: 'زنتان', nameEn: 'Zintan' },
  { code: 'zawiyat_al_jahmi', nameAr: 'زاوية الجهني', nameEn: 'Zawiyat al Jahmi' },
  { code: 'gharyan', nameAr: 'غريان', nameEn: 'Gharyan' },
  { code: 'sabha', nameAr: 'سبها', nameEn: 'Sabha' },
  { code: 'sabrata', nameAr: 'صبراتة', nameEn: 'Sabrata' },
  { code: 'sirte', nameAr: 'سرت', nameEn: 'Sirte' },
  { code: 'tobruk', nameAr: 'طبرق', nameEn: 'Tobruk' },
  { code: 'derna', nameAr: 'درنة', nameEn: 'Derna' },
  { code: 'ajdabiya', nameAr: 'أجدابيا', nameEn: 'Ajdabiya' },
  { code: 'ghat', nameAr: 'غات', nameEn: 'Ghat' },
  { code: 'homs', nameAr: 'الخمس', nameEn: 'Al Khums' },
  { code: 'jumayl', nameAr: 'الجميل', nameEn: 'Al Jumayl' },
  { code: 'kikla', nameAr: 'ككلة', nameEn: 'Kikla' },
  { code: 'mizda', nameAr: 'مزدة', nameEn: 'Mizda' },
  { code: 'murzuq', nameAr: 'مرزق', nameEn: 'Murzuq' },
  { code: 'nalut', nameAr: 'نالوت', nameEn: 'Nalut' },
  { code: 'nuqat_al_khams', nameAr: 'نقاط الخمس', nameEn: 'Nuqat al Khams' },
  { code: 'rajlaban', nameAr: 'رجلبان', nameEn: 'Rajlaban' },
  { code: 'slitan', nameAr: 'سليتان', nameEn: 'Slitan' },
  { code: 'surman', nameAr: 'صرمان', nameEn: 'Surman' },
  { code: 'tarhuna', nameAr: 'ترهونة', nameEn: 'Tarhuna' },
  { code: 'wadi_al_shatii', nameAr: 'وادي الشاطئ', nameEn: 'Wadi al Shatii' },
  { code: 'yafran', nameAr: 'يفرن', nameEn: 'Yafran' },
  { code: 'bani_walid', nameAr: 'بني وليد', nameEn: 'Bani Walid' },
  { code: 'ghadamis', nameAr: 'غدامس', nameEn: 'Ghadames' },
  { code: 'ujaylat', nameAr: 'عجيلات', nameEn: 'Ujaylat' },
  { code: 'asabia', nameAr: 'العصابية', nameEn: 'Asabia' },
  { code: 'brak', nameAr: 'براك', nameEn: 'Brak' },
  { code: 'hun', nameAr: 'هون', nameEn: 'Hun' },
  { code: 'awjila', nameAr: 'أوجلة', nameEn: 'Awjila' },
  { code: 'jalu', nameAr: 'جالو', nameEn: 'Jalu' },
  { code: 'kufra', nameAr: 'الكفرة', nameEn: 'Kufra' },
  { code: 'marada', nameAr: 'مرادة', nameEn: 'Marada' },
  { code: 'massa', nameAr: 'الماسة', nameEn: 'Massa' },
  { code: 'nalut', nameAr: 'نالوت', nameEn: 'Nalut' },
  { code: 'ghazaya', nameAr: 'غزايا', nameEn: 'Ghazaya' },
];

/**
 * Get all cities sorted alphabetically by English name.
 * @returns {LibyanCity[]}
 */
export function getLibyanCitiesSorted() {
  return [...LIBYAN_CITIES].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
}

/**
 * Find a city by code.
 * @param {string} code
 * @returns {LibyanCity | undefined}
 */
export function findLibyanCity(code) {
  return LIBYAN_CITIES.find((c) => c.code === code);
}
