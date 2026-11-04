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

it('translates the completed-treatment booking reconciliation handoff', () => {
  const { result } = renderHook(useGammaKnifeText, { wrapper: LanguageProvider });
  expect(result.current.tr('Gamma Knife')).toBe('قاما نايف');
  expect(result.current.tr('Gamma Knife patient page')).toBe('صفحة مريض قاما نايف');
  expect(result.current.tr('Treatment completion is recorded, but this RISpro booking is still marked scheduled. Reconcile the appointment status with the treatment record.')).toBe('تم تسجيل اكتمال العلاج، لكن موعد RISpro المرتبط لا يزال بحالة محجوز. راجع حالة الموعد لتتوافق مع سجل العلاج.');
  expect(result.current.tr('Review booking in RISpro')).toBe('مراجعة الموعد في RISpro');
  expect(result.current.tr('Ask an authorized scheduling user to review this booking.')).toBe('اطلب من مستخدم مخول بجدولة المواعيد مراجعة هذا الموعد.');
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

it('localizes the expanded worklist, correction, and clinical safety guidance', () => {
  const { result } = renderHook(useGammaKnifeText, { wrapper: LanguageProvider });
  expect(result.current.tr('Follow-up timing')).toBe('توقيت المتابعة');
  expect(result.current.tr('Open next task')).toBe('فتح المهمة التالية');
  expect(result.current.tr('Selected patient:')).toBe('المريض المحدد:');
  expect(result.current.tr('Clinical snapshot')).toBe('ملخص سريري');
  expect(result.current.tr('Correct recorded MDT decision')).toBe('تصحيح قرار الفريق المسجل');
  expect(result.current.tr('Required sections complete')).toBe('الأقسام المطلوبة المكتملة');
  expect(result.current.tr('GammaPlan remains the authoritative system for treatment planning and machine QA. RISpro records clinical readiness, treatment completion, and documentation.')).toContain('GammaPlan');
});
