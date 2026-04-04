// @ts-check

/**
 * Libyan cities list for frontend address dropdown.
 * Mirrors src/utils/libyan-cities.js.
 */

/**
 * @typedef LibyanCity
 * @property {string} code
 * @property {string} nameAr
 * @property {string} nameEn
 */

/** @type {LibyanCity[]} */
export const LIBYAN_CITIES = [
  { code: 'tripoli', nameAr: 'طرابلس', nameEn: 'Tripoli' },
  { code: 'benghazi', nameAr: 'بنغازي', nameEn: 'Benghazi' },
  { code: 'misrata', nameAr: 'مصراتة', nameEn: 'Misrata' },
  { code: 'bayda', nameAr: 'البيضاء', nameEn: 'Al Bayda' },
  { code: 'zawiya', nameAr: 'الزاوية', nameEn: 'Zawiya' },
  { code: 'zintan', nameAr: 'زنتان', nameEn: 'Zintan' },
  { code: 'gharyan', nameAr: 'غريان', nameEn: 'Gharyan' },
  { code: 'sabha', nameAr: 'سبها', nameEn: 'Sabha' },
  { code: 'sabrata', nameAr: 'صبراتة', nameEn: 'Sabrata' },
  { code: 'sirte', nameAr: 'سرت', nameEn: 'Sirte' },
  { code: 'tobruk', nameAr: 'طبرق', nameEn: 'Tobruk' },
  { code: 'derna', nameAr: 'درنة', nameEn: 'Derna' },
  { code: 'ajdabiya', nameAr: 'أجدابيا', nameEn: 'Ajdabiya' },
  { code: 'ghat', nameAr: 'غات', nameEn: 'Ghat' },
  { code: 'homs', nameAr: 'الخمس', nameEn: 'Al Khums' },
  { code: 'tarhuna', nameAr: 'ترهونة', nameEn: 'Tarhuna' },
  { code: 'bani_walid', nameAr: 'بني وليد', nameEn: 'Bani Walid' },
  { code: 'ghadamis', nameAr: 'غدامس', nameEn: 'Ghadames' },
  { code: 'murzuq', nameAr: 'مرزق', nameEn: 'Murzuq' },
  { code: 'nalut', nameAr: 'نالوت', nameEn: 'Nalut' },
  { code: 'yafran', nameAr: 'يفرن', nameEn: 'Yafran' },
  { code: 'surman', nameAr: 'صرمان', nameEn: 'Surman' },
  { code: 'kufra', nameAr: 'الكفرة', nameEn: 'Kufra' },
  { code: 'hun', nameAr: 'هون', nameEn: 'Hun' },
  { code: 'brak', nameAr: 'براك', nameEn: 'Brak' },
  { code: 'awjila', nameAr: 'أوجلة', nameEn: 'Awjila' },
  { code: 'jalu', nameAr: 'جالو', nameEn: 'Jalu' },
  { code: 'mizda', nameAr: 'مزدة', nameEn: 'Mizda' },
  { code: 'marada', nameAr: 'مرادة', nameEn: 'Marada' },
];

/** @type {LibyanCity[]} */
export const LIBYAN_CITIES_SORTED = [...LIBYAN_CITIES].sort((a, b) =>
  a.nameEn.localeCompare(b.nameEn)
);
