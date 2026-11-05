import { useLanguage } from '@/providers/language-provider';
import { gammaKnifeSourceKeys } from '@/lib/i18n/gamma-knife';
import { chooseLocalized, type TranslationKey } from '@/lib/i18n';

const permissionLabels: Record<string, string> = { access: 'Module access', referral: 'Register referrals', clinical: 'Clinical assessment and follow-up', mdt: 'Record MDT decisions', treatment: 'Document treatment', scheduling: 'Link and confirm appointments', documents: 'Documents and patient QR', episode_correction: 'Episode correction and reversal', identity_review: 'Review identity correction requests' };
const categoryLabels: Record<string, string> = { referral: 'Referral', investigation: 'Requested investigations', consent: 'Consent', treatment_report: 'Treatment report', patient_instructions: 'Preparation instructions', other: 'Other' };
const statusLabels: Record<string, string> = { draft: 'Draft', provisional: 'Provisional', finalized: 'Finalized', approved: 'Approved', additional_information: 'Additional information required', deferred: 'Deferred', not_suitable: 'Not suitable', scheduled: 'Scheduled', arrived: 'Arrived', waiting: 'Waiting', awaiting_booking: 'Awaiting booking', booked: 'Booked', due_soon: 'Due soon', overdue: 'Overdue', open: 'Open', missing_report: 'Missing report', cancelled: 'Cancelled', completed: 'Completed', planned: 'Planned', in_progress: 'In progress', interrupted: 'Interrupted', requested: 'Requested', awaiting_information: 'Awaiting information', decided: 'Decision recorded', received: 'Received', delivered: 'Delivered', not_delivered: 'Not delivered', internal: 'Internal only', routine: 'Routine patient document', sensitive: 'Sensitive — verification required', frame: 'Frame', mask: 'Mask' };

export function useGammaKnifeText() {
  const context = useLanguage();
  const tr = (source: string): string => { const key = gammaKnifeSourceKeys[source]; return key ? context.t(key) : source; };
  const permission = (value: string) => context.isArabic ? tr(value === 'episode_correction' ? 'Episode correction and reversal' : value === 'identity_review' ? 'Review identity correction requests' : `permission.${value}`) : permissionLabels[value] ?? value;
  const category = (value: string) => tr(categoryLabels[value] ?? value);
  const status = (value: string) => tr(statusLabels[value] ?? value);
  const errorText = (message: string) => {
    if (!context.isArabic || gammaKnifeSourceKeys[message]) return tr(message);
    if (message.includes('required') || message.includes('must be')) return context.t('gk.completeRequired');
    if (message.includes('changed') || message.includes('Reload')) return context.t('gk.conflict');
    return context.t('gk.genericError');
  };
  const dateText = (value: string) => value ? new Intl.DateTimeFormat(context.isArabic ? 'ar-LY' : 'en-GB', { timeZone: 'Africa/Tripoli', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value.slice(0,10)}T12:00:00+02:00`)) : '';
  const patientName = (patient: { patientName?: string; patientArabicName?: string | null; patientEnglishName?: string | null }) => chooseLocalized(context.language, patient.patientArabicName, patient.patientEnglishName) || patient.patientName || '';
  const roleText = (value: string) => {
    const keys: Record<string, TranslationKey> = { super_admin: 'role.superAdministrator', supervisor: 'role.supervisor', doctor: 'role.doctor', receptionist: 'role.receptionist', administrative: 'role.administrative', modality_staff: 'role.modalityStaff' };
    return keys[value] ? context.t(keys[value]) : value;
  };
  return { ...context, tr, errorText, permissionText: permission, categoryText: category, statusText: status, dateText, patientName, roleText };
}
