import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LanguageProvider } from '@/providers/language-provider-component';
import { gammaKnifeAr, gammaKnifeEn } from '@/lib/i18n/gamma-knife';
import { t } from '@/lib/i18n';
import { useGammaKnifeText } from './use-gamma-knife-text';

beforeEach(() => localStorage.setItem('rispro-language', 'ar'));
afterEach(cleanup);

it('registers complete Gamma Knife Arabic copy in the existing application catalogs', () => {
  expect(Object.keys(gammaKnifeAr).sort()).toEqual(Object.keys(gammaKnifeEn).sort());
  for (const key of Object.keys(gammaKnifeEn) as (keyof typeof gammaKnifeEn)[]) {
    expect(t('en', key)).toBe(gammaKnifeEn[key]);
    expect(t('ar', key)).toBe(gammaKnifeAr[key]);
    expect(gammaKnifeAr[key].trim()).not.toBe('');
    expect(gammaKnifeAr[key]).not.toMatch(/\?{2,}|\uFFFD/);
  }
});

it('keeps booked status separate from patient confirmation and translates failure guidance', () => {
  const { result } = renderHook(useGammaKnifeText, { wrapper: LanguageProvider });
  expect(result.current.statusText('scheduled')).toBe('محجوز');
  expect(result.current.tr('Confirmed')).toBe('مؤكد');
  expect(result.current.permissionText('clinical')).toBe('التقييم والمتابعة');
  expect(result.current.errorText('Episode changed. Reload and review before saving.')).toContain('عُدلت الحالة');
  expect(result.current.errorText('Examination is required and must be within 20000 characters.')).toBe('يرجى استكمال المعلومات المطلوبة.');
  expect(result.current.tr('Sensitive document — contact the clinic')).toBe('مستند حساس — تواصل مع العيادة');
});

it('selects the recorded patient name for the chosen language without translating clinical content', () => {
  const patient = { patientArabicName: 'مريض تجريبي', patientEnglishName: 'Synthetic patient' };
  const { result } = renderHook(useGammaKnifeText, { wrapper: LanguageProvider });
  expect(result.current.patientName(patient)).toBe('مريض تجريبي');
  expect(result.current.tr('Clinical')).toBe('التقييم السريري');
  act(() => result.current.toggleLanguage());
  expect(result.current.patientName(patient)).toBe('Synthetic patient');
  expect(result.current.tr('Clinical')).toBe('Clinical');
});
