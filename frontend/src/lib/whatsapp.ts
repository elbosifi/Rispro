import { chooseLocalized, t } from "./i18n";
import { formatDateLy } from "./date-format";

export type WhatsappTemplate =
  | "qr_link"
  | "appointment_reminder"
  | "appointment_rescheduled"
  | "appointment_changed"
  | "appointment_cancelled";

export interface WhatsappAppointment {
  bookingDate: string;
  publicAppointmentUrl?: string | null;
}

export interface WhatsappTemplateStrings {
  whatsappQrLinkMessageAr: string;
  whatsappQrLinkMessageEn: string;
  whatsappReminderMessageAr: string;
  whatsappReminderMessageEn: string;
  whatsappRescheduledMessageAr: string;
  whatsappRescheduledMessageEn: string;
  whatsappChangedMessageAr: string;
  whatsappChangedMessageEn: string;
  whatsappCancelledMessageAr: string;
  whatsappCancelledMessageEn: string;
}

export function normalizeWhatsappPhone(phone: string | null | undefined): string {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `218${digits.slice(1)}`;
  return digits;
}

export function buildAppointmentWhatsappText(
  template: WhatsappTemplate,
  appointment: WhatsappAppointment,
  language: "ar" | "en",
  settings?: Partial<WhatsappTemplateStrings> | null
): string {
  const link = String(appointment.publicAppointmentUrl || "").trim();
  const date = formatDateLy(appointment.bookingDate);
  const templates: Record<WhatsappTemplate, string> = {
    qr_link: chooseLocalized(language, settings?.whatsappQrLinkMessageAr, settings?.whatsappQrLinkMessageEn) || t(language, "registrations.whatsappMessageQrLink"),
    appointment_reminder: chooseLocalized(language, settings?.whatsappReminderMessageAr, settings?.whatsappReminderMessageEn) || t(language, "registrations.whatsappMessageReminder"),
    appointment_rescheduled: chooseLocalized(language, settings?.whatsappRescheduledMessageAr, settings?.whatsappRescheduledMessageEn) || t(language, "registrations.whatsappMessageRescheduled"),
    appointment_changed: chooseLocalized(language, settings?.whatsappChangedMessageAr, settings?.whatsappChangedMessageEn) || t(language, "registrations.whatsappMessageChanged"),
    appointment_cancelled: chooseLocalized(language, settings?.whatsappCancelledMessageAr, settings?.whatsappCancelledMessageEn) || t(language, "registrations.whatsappMessageCancelled"),
  };

  return String(templates[template] || templates.qr_link)
    .replace(/\{link\}/g, link)
    .replace(/\{date\}/g, date);
}
