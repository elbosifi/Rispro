import { api } from "@/lib/api-client";
import { mapAppointmentWithDetails, type AppointmentWithDetails } from "@/lib/mappers";

type RawRecord = Record<string, unknown>;

// -- Appointments --
export async function getAppointmentAvailability(
  modalityId: number,
  days = 14,
  offset = 0,
  options: {
    examTypeId?: number;
    caseCategory?: string;
    useSpecialQuota?: boolean;
    specialReasonCode?: string;
    includeOverrideCandidates?: boolean;
  } = {}
) {
  const params = new URLSearchParams();
  params.set("modalityId", String(modalityId));
  params.set("days", String(days));
  params.set("offset", String(offset));
  if (options.examTypeId) params.set("examTypeId", String(options.examTypeId));
  if (options.caseCategory) params.set("caseCategory", options.caseCategory);
  if (options.useSpecialQuota) params.set("useSpecialQuota", "true");
  if (options.specialReasonCode) params.set("specialReasonCode", options.specialReasonCode);
  if (options.includeOverrideCandidates) params.set("includeOverrideCandidates", "true");
  const raw = await api<{ availability: RawRecord[] }>(`/appointments/availability?${params.toString()}`);
  return raw.availability;
}

export async function getAppointmentSuggestions(params: {
  modalityId: number;
  examTypeId?: number | null;
  caseCategory?: string;
  useSpecialQuota?: boolean;
  specialReasonCode?: string | null;
  includeOverrideCandidates?: boolean;
  days?: number;
}) {
  const query = new URLSearchParams();
  query.set("modalityId", String(params.modalityId));
  query.set("days", String(params.days || 30));
  if (params.examTypeId) query.set("examTypeId", String(params.examTypeId));
  if (params.caseCategory) query.set("caseCategory", params.caseCategory);
  if (params.useSpecialQuota) query.set("useSpecialQuota", "true");
  if (params.specialReasonCode) query.set("specialReasonCode", params.specialReasonCode);
  if (params.includeOverrideCandidates) query.set("includeOverrideCandidates", "true");
  const raw = await api<{ suggestions: RawRecord[] }>(`/appointments/suggestions?${query.toString()}`);
  return raw.suggestions;
}

export async function getAppointmentById(id: number) {
  const raw = await api<{ appointment: RawRecord }>(`/v2/read/appointments/${id}`);
  return mapAppointmentWithDetails(raw.appointment);
}

export async function getV2AppointmentPrintDetails(bookingId: number) {
  const raw = await api<{ appointment: RawRecord }>(`/v2/read/appointments/${bookingId}`);
  return mapAppointmentWithDetails(raw.appointment);
}

export interface PublicAppointmentCancelPreview {
  bookingId: number;
  patientDisplayName: string;
  bookingDate: string;
  bookingTime?: string;
  requiresReport?: boolean;
  reportFeature?: {
    allowReportAccess: boolean;
    allowImageAccess: boolean;
    reportAccessAllowedForModality?: boolean;
    imageAccessAllowedForModality?: boolean;
    showReportPendingCard: boolean;
    reportAccessRequiresCompletedAppointment: boolean;
    imageAccessRequiresCompletedAppointment: boolean;
    imageAccessRequiresReportRequiredFlag: boolean;
    showReportNotRequiredMessage: boolean;
    qrReportCheckingMessage: string;
    qrReportCheckButtonLabel: string;
    qrReportViewButtonLabel: string;
    qrImageViewButtonLabel: string;
    qrReportNotRequiredMessage: string;
    qrReportNotCompletedMessage: string;
    qrImageUnavailableMessage: string;
    qrReportStudyNotFoundMessage: string;
    qrImageStudyNotFoundMessage: string;
  };
  modalityName?: string;
  modalityId?: number;
  modalityNameAr?: string;
  modalityNameEn?: string;
  examName?: string;
  examNameAr?: string;
  examNameEn?: string;
  modalityInstructionAr?: string;
  modalityInstructionEn?: string;
  examInstructionAr?: string;
  examInstructionEn?: string;
  currentStatus: string;
  patientQrSettings?: PatientQrSettings;
  otherAppointments?: PublicAppointmentOtherAppointment[];
}

export interface PublicAppointmentOtherAppointment {
  date: string;
  time?: string;
  modality: string;
  examName: string;
  status: string;
  publicUrl: string;
  canCancel?: boolean;
}

export interface PublicAppointmentCancelResult {
  ok: boolean;
  alreadyCancelled: boolean;
  bookingId: number;
  status: string;
  previousStatus?: string;
}

export async function fetchPublicAppointmentCancelPreview(token: string): Promise<PublicAppointmentCancelPreview> {
  const query = new URLSearchParams({ t: token });
  const raw = await api<{ preview: RawRecord; otherAppointments?: RawRecord[]; settings?: RawRecord | RawRecord[] }>(`/public/appointments/cancel-preview?${query.toString()}`);
  const preview = raw.preview ?? {};

  // Handle both array format (raw records) and object format from the public endpoint.
  let patientQrSettings: PatientQrSettings | undefined;
  if (raw.settings) {
    if (Array.isArray(raw.settings)) {
      patientQrSettings = raw.settings.length > 0 ? sanitizePatientQrTextEncoding(normalizePatientQrSettings(raw.settings[0])) : undefined;
    } else {
      patientQrSettings = sanitizePatientQrTextEncoding(normalizePatientQrSettings(raw.settings));
    }
  }

  return {
    bookingId: Number(preview.bookingId ?? preview.booking_id ?? 0),
    patientDisplayName: String(preview.patientDisplayName ?? preview.patient_display_name ?? ""),
    bookingDate: String(preview.bookingDate ?? preview.booking_date ?? ""),
    bookingTime: String(preview.bookingTime ?? preview.booking_time ?? ""),
    requiresReport: Boolean(preview.requiresReport ?? preview.requires_report),
    reportFeature: preview.reportFeature as PublicAppointmentCancelPreview["reportFeature"],
    modalityId: Number(preview.modalityId ?? preview.modality_id ?? 0) || undefined,
    modalityName: String(preview.modalityName ?? preview.modality_name ?? preview.modalityNameAr ?? preview.modality_name_ar ?? "—"),
    modalityNameAr: String(preview.modalityNameAr ?? preview.modality_name_ar ?? ""),
    modalityNameEn: String(preview.modalityNameEn ?? preview.modality_name_en ?? ""),
    examName: String(preview.examName ?? preview.exam_name ?? preview.examNameAr ?? preview.exam_name_ar ?? "—"),
    examNameAr: String(preview.examNameAr ?? preview.exam_name_ar ?? ""),
    examNameEn: String(preview.examNameEn ?? preview.exam_name_en ?? ""),
    modalityInstructionAr: String(preview.modalityInstructionAr ?? preview.modality_instruction_ar ?? ""),
    modalityInstructionEn: String(preview.modalityInstructionEn ?? preview.modality_instruction_en ?? ""),
    examInstructionAr: String(preview.examInstructionAr ?? preview.exam_instruction_ar ?? ""),
    examInstructionEn: String(preview.examInstructionEn ?? preview.exam_instruction_en ?? ""),
    currentStatus: String(preview.currentStatus ?? preview.current_status ?? ""),
    patientQrSettings,
    otherAppointments: (raw.otherAppointments ?? []).map((appointment) => ({
      date: String(appointment.date ?? ""),
      time: String(appointment.time ?? ""),
      modality: String(appointment.modality ?? "—"),
      examName: String(appointment.examName ?? appointment.exam_name ?? "—"),
      status: String(appointment.status ?? ""),
      publicUrl: String(appointment.publicUrl ?? appointment.public_url ?? ""),
      canCancel: Boolean(appointment.canCancel ?? appointment.can_cancel),
    })).filter((appointment) => appointment.date && appointment.publicUrl),
  };
}

export interface PublicAppointmentSlipDetails {
  appointment: AppointmentWithDetails;
  slipSettings: AppointmentSlipSettings;
  patientQrSettings: PatientQrSettings;
}

export async function fetchPublicAppointmentSlipDetails(token: string): Promise<PublicAppointmentSlipDetails> {
  const query = new URLSearchParams({ t: token });
  const raw = await api<{ appointment: RawRecord; slipSettings: RawRecord; patientQrSettings: RawRecord }>(`/public/appointments/slip?${query.toString()}`);
  return {
    appointment: mapAppointmentWithDetails(raw.appointment),
    slipSettings: sanitizeAppointmentSlipTextEncoding(normalizeAppointmentSlipSettings(raw.slipSettings ?? {})),
    patientQrSettings: sanitizePatientQrTextEncoding(normalizePatientQrSettings(raw.patientQrSettings ?? {})),
  };
}

export async function cancelPublicAppointment(token: string): Promise<PublicAppointmentCancelResult> {
  const query = new URLSearchParams({ t: token });
  const raw = await api<RawRecord>(`/public/appointments/cancel?${query.toString()}`, {
    method: "POST",
  });

  return {
    ok: Boolean(raw.ok),
    alreadyCancelled: Boolean(raw.alreadyCancelled ?? raw.already_cancelled),
    bookingId: Number(raw.bookingId ?? raw.booking_id ?? 0),
    status: String(raw.status ?? ""),
    previousStatus: raw.previousStatus == null ? undefined : String(raw.previousStatus),
  };
}

export interface PublicReportStatusResponse {
  enabled: boolean;
  state: "final" | "draft" | "no_report" | "study_not_found" | "unavailable" | "not_required" | "not_completed" | "disabled";
  canViewReport: boolean;
  message: string;
  checkButtonLabel: string;
  viewButtonLabel: string;
}

export async function fetchPublicAppointmentReportStatus(token: string): Promise<PublicReportStatusResponse> {
  const query = new URLSearchParams({ t: token });
  return api<PublicReportStatusResponse>(`/public/appointments/report-status?${query.toString()}`);
}

export interface PatientPushPreferences {
  appointmentReminder24h: boolean;
  appointmentRescheduled: boolean;
  appointmentCancelled: boolean;
  appointmentChanged: boolean;
  reportReady: boolean;
  imageReady: boolean;
}

export interface PublicPushConfigResponse {
  enabled: boolean;
  vapidPublicKey: string;
  defaults: PatientPushPreferences;
  labels: {
    cardTitleAr: string;
    cardTitleEn: string;
    cardBodyAr: string;
    cardBodyEn: string;
    subscribeButtonAr: string;
    subscribeButtonEn: string;
    unsubscribeButtonAr: string;
    unsubscribeButtonEn: string;
    testButtonAr: string;
    testButtonEn: string;
    unsupportedMessageAr: string;
    unsupportedMessageEn: string;
    iosHelpButtonAr: string;
    iosHelpButtonEn: string;
    iosHelpTitleAr: string;
    iosHelpTitleEn: string;
    iosHelpBodyAr: string;
    iosHelpBodyEn: string;
    deniedMessageAr: string;
    deniedMessageEn: string;
  };
}

export async function fetchPublicPushConfig(token: string): Promise<PublicPushConfigResponse> {
  const query = new URLSearchParams({ t: token });
  return api<PublicPushConfigResponse>(`/public/appointments/push-config?${query.toString()}`);
}

export async function subscribePublicPush(token: string, subscription: PushSubscriptionJSON, preferences: PatientPushPreferences) {
  const query = new URLSearchParams({ t: token });
  return api<{ ok: true; subscriptionId: number; bookingSubscriptionId: number }>(`/public/appointments/push-subscribe?${query.toString()}`, {
    method: "POST",
    body: JSON.stringify({ subscription, preferences }),
  });
}

export async function unsubscribePublicPush(token: string, subscription: PushSubscriptionJSON) {
  const query = new URLSearchParams({ t: token });
  return api<{ ok: true; disabled: boolean }>(`/public/appointments/push-unsubscribe?${query.toString()}`, {
    method: "POST",
    body: JSON.stringify({ subscription }),
  });
}

export async function testPublicPush(token: string) {
  const query = new URLSearchParams({ t: token });
  return api<{ ok: true; eventId: number | null; attempted: number; sent: number }>(`/public/appointments/push-test?${query.toString()}`, {
    method: "POST",
  });
}

export interface PatientQrContactSettings {
  primaryPhone: string;
  secondaryPhone: string;
  whatsapp: string;
  whatsappEnabled: boolean;
  workingHoursAr: string;
  workingHoursEn: string;
  noteAr: string;
  noteEn: string;
}

export interface PatientQrLocationSettings {
  centerNameAr: string;
  centerNameEn: string;
  departmentLocationAr: string;
  departmentLocationEn: string;
  roomUnitFloorAr: string;
  roomUnitFloorEn: string;
  addressAr: string;
  addressEn: string;
  arrivalInstructionsAr: string;
  arrivalInstructionsEn: string;
  googleMapsUrl: string;
  parkingNoteAr: string;
  parkingNoteEn: string;
}

export interface PatientQrSettings {
  enabled: boolean;
  risproPublicBaseUrl: string;
  printQrOnAppointmentSlip: boolean;
  qrSlipPaperMode: AppointmentSlipPaperMode;
  qrSlipPaperSize: AppointmentSlipPaperSize;
  allowCancellation: boolean;
  allowAddToCalendar: boolean;
  publicLinkValidityDays: number;
  showBookingTime: boolean;
  showPreparationInstructions: boolean;
  showDocumentsChecklist: boolean;
  showDepartmentContact: boolean;
  showLocationDirections: boolean;
  allowReportAccess: boolean;
  reportAccessModalityMode: "all" | "include" | "exclude";
  reportAccessModalityIds: number[];
  allowImageAccess: boolean;
  imageAccessModalityMode: "all" | "include" | "exclude";
  imageAccessModalityIds: number[];
  showReportPendingCard: boolean;
  reportAccessRequiresCompletedAppointment: boolean;
  imageAccessRequiresCompletedAppointment: boolean;
  imageAccessRequiresReportRequiredFlag: boolean;
  showReportNotRequiredMessage: boolean;
  defaultReportRequiredForOncology: boolean;
  defaultReportRequiredForNonOncology: boolean;
  qrReportCheckingMessage: string;
  qrReportFinalMessage: string;
  qrReportDraftMessage: string;
  qrReportNoReportMessage: string;
  qrReportUnavailableMessage: string;
  qrReportNotRequiredMessage: string;
  qrReportNotCompletedMessage: string;
  qrReportCheckButtonLabel: string;
  qrReportViewButtonLabel: string;
  qrImageViewButtonLabel: string;
  qrImageUnavailableMessage: string;
  qrReportStudyNotFoundMessage: string;
  qrImageStudyNotFoundMessage: string;
  webPushEnabled: boolean;
  webPushDefaultReminder24h: boolean;
  webPushDefaultRescheduled: boolean;
  webPushDefaultCancelled: boolean;
  webPushDefaultChanged: boolean;
  webPushDefaultReportReady: boolean;
  webPushDefaultImageReady: boolean;
  webPushCardTitleAr: string;
  webPushCardTitleEn: string;
  webPushCardBodyAr: string;
  webPushCardBodyEn: string;
  webPushSubscribeButtonAr: string;
  webPushSubscribeButtonEn: string;
  webPushUnsubscribeButtonAr: string;
  webPushUnsubscribeButtonEn: string;
  webPushTestButtonAr: string;
  webPushTestButtonEn: string;
  webPushUnsupportedMessageAr: string;
  webPushUnsupportedMessageEn: string;
  webPushIosHelpButtonAr: string;
  webPushIosHelpButtonEn: string;
  webPushIosHelpTitleAr: string;
  webPushIosHelpTitleEn: string;
  webPushIosHelpBodyAr: string;
  webPushIosHelpBodyEn: string;
  webPushDeniedMessageAr: string;
  webPushDeniedMessageEn: string;
  webPushAppointmentReminder24hTitle: string;
  webPushAppointmentReminder24hBody: string;
  webPushAppointmentReminder24hTitleAr: string;
  webPushAppointmentReminder24hBodyAr: string;
  webPushAppointmentRescheduledTitle: string;
  webPushAppointmentRescheduledBody: string;
  webPushAppointmentRescheduledTitleAr: string;
  webPushAppointmentRescheduledBodyAr: string;
  webPushAppointmentCancelledTitle: string;
  webPushAppointmentCancelledBody: string;
  webPushAppointmentCancelledTitleAr: string;
  webPushAppointmentCancelledBodyAr: string;
  webPushAppointmentChangedTitle: string;
  webPushAppointmentChangedBody: string;
  webPushAppointmentChangedTitleAr: string;
  webPushAppointmentChangedBodyAr: string;
  webPushReportReadyTitle: string;
  webPushReportReadyBody: string;
  webPushReportReadyTitleAr: string;
  webPushReportReadyBodyAr: string;
  webPushImageReadyTitle: string;
  webPushImageReadyBody: string;
  webPushImageReadyTitleAr: string;
  webPushImageReadyBodyAr: string;
  webPushTestTitle: string;
  webPushTestBody: string;
  webPushTestTitleAr: string;
  webPushTestBodyAr: string;
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
  pageTitleAr: string;
  pageTitleEn: string;
  introTextAr: string;
  introTextEn: string;
  genericPreparationTextAr: string;
  genericPreparationTextEn: string;
  documentsChecklistAr: string[];
  documentsChecklistEn: string[];
  contact: PatientQrContactSettings;
  location: PatientQrLocationSettings;
}

export const DEFAULT_PATIENT_QR_SETTINGS: PatientQrSettings = {
  enabled: true,
  risproPublicBaseUrl: "https://rispro.nccb.com.ly",
  printQrOnAppointmentSlip: true,
  qrSlipPaperMode: "blank",
  qrSlipPaperSize: "a4",
  allowCancellation: true,
  allowAddToCalendar: true,
  publicLinkValidityDays: 14,
  showBookingTime: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: false,
  showLocationDirections: false,
  allowReportAccess: false,
  reportAccessModalityMode: "all",
  reportAccessModalityIds: [],
  allowImageAccess: false,
  imageAccessModalityMode: "all",
  imageAccessModalityIds: [],
  showReportPendingCard: true,
  reportAccessRequiresCompletedAppointment: true,
  imageAccessRequiresCompletedAppointment: true,
  imageAccessRequiresReportRequiredFlag: false,
  showReportNotRequiredMessage: false,
  defaultReportRequiredForOncology: true,
  defaultReportRequiredForNonOncology: false,
  qrReportCheckingMessage: "Checking report status...",
  qrReportFinalMessage: "Your report is ready.",
  qrReportDraftMessage: "Your report is still under review and is not finalized yet.",
  qrReportNoReportMessage: "No report is available for this appointment yet.",
  qrReportUnavailableMessage: "The report system is temporarily unavailable. Please try again later.",
  qrReportNotRequiredMessage: "",
  qrReportNotCompletedMessage: "Report access becomes available after the examination is completed.",
  qrReportCheckButtonLabel: "Check report",
  qrReportViewButtonLabel: "View report",
  qrImageViewButtonLabel: "View images",
  qrImageUnavailableMessage: "Image viewing is currently unavailable. Please try again later.",
  qrReportStudyNotFoundMessage: "Your study is not available in the report system yet. Please try again later.",
  qrImageStudyNotFoundMessage: "Your study images are not available yet. Please try again later.",
  pageTitleAr: "خدمة المريض عبر رمز QR",
  webPushEnabled: false,
  webPushDefaultReminder24h: true,
  webPushDefaultRescheduled: true,
  webPushDefaultCancelled: true,
  webPushDefaultChanged: true,
  webPushDefaultReportReady: true,
  webPushDefaultImageReady: false,
  webPushCardTitleAr: "تذكير وتنبيهات الموعد",
  webPushCardTitleEn: "Appointment reminders and alerts",
  webPushCardBodyAr: "يمكنك تفعيل تنبيهات المتصفح لهذا الموعد.",
  webPushCardBodyEn: "You can enable browser notifications for this appointment.",
  webPushSubscribeButtonAr: "تفعيل التنبيهات",
  webPushSubscribeButtonEn: "Enable notifications",
  webPushUnsubscribeButtonAr: "إيقاف التنبيهات",
  webPushUnsubscribeButtonEn: "Disable notifications",
  webPushTestButtonAr: "إرسال تنبيه تجريبي",
  webPushTestButtonEn: "Send test notification",
  webPushUnsupportedMessageAr: "تنبيهات المتصفح غير مدعومة على هذا الجهاز.",
  webPushUnsupportedMessageEn: "Browser notifications are not supported on this device.",
  webPushIosHelpButtonAr: "طريقة التفعيل على iPhone",
  webPushIosHelpButtonEn: "How to enable on iPhone",
  webPushIosHelpTitleAr: "لتفعيل التنبيهات على iPhone",
  webPushIosHelpTitleEn: "To enable notifications on iPhone",
  webPushIosHelpBodyAr: "افتح هذه الصفحة في Safari، اضغط زر المشاركة، اختر إضافة إلى الشاشة الرئيسية، ثم افتح RISpro من الأيقونة الجديدة وفعّل التنبيهات من هناك. يتطلب ذلك iOS 16.4 أو أحدث.",
  webPushIosHelpBodyEn: "Open this page in Safari, tap Share, choose Add to Home Screen, then open RISpro from the new icon and enable notifications there. This requires iOS 16.4 or later.",
  webPushDeniedMessageAr: "تم رفض إذن التنبيهات من المتصفح.",
  webPushDeniedMessageEn: "Notification permission was denied in this browser.",
  webPushAppointmentReminder24hTitle: "Appointment reminder",
  webPushAppointmentReminder24hBody: "You have an appointment soon. Open your appointment page for details.",
  webPushAppointmentReminder24hTitleAr: "تذكير بالموعد",
  webPushAppointmentReminder24hBodyAr: "لديك موعد قريب. افتح صفحة الموعد للاطلاع على التفاصيل.",
  webPushAppointmentRescheduledTitle: "Appointment updated",
  webPushAppointmentRescheduledBody: "Your appointment date or time changed. Open your appointment page for details.",
  webPushAppointmentRescheduledTitleAr: "تم تحديث الموعد",
  webPushAppointmentRescheduledBodyAr: "تم تغيير تاريخ أو وقت الموعد. افتح صفحة الموعد للاطلاع على التفاصيل.",
  webPushAppointmentCancelledTitle: "Appointment cancelled",
  webPushAppointmentCancelledBody: "Your appointment has been cancelled. Open your appointment page for details.",
  webPushAppointmentCancelledTitleAr: "تم إلغاء الموعد",
  webPushAppointmentCancelledBodyAr: "تم إلغاء موعدك. افتح صفحة الموعد للاطلاع على التفاصيل.",
  webPushAppointmentChangedTitle: "Appointment updated",
  webPushAppointmentChangedBody: "Your appointment details changed. Open your appointment page for details.",
  webPushAppointmentChangedTitleAr: "تم تحديث الموعد",
  webPushAppointmentChangedBodyAr: "تم تحديث تفاصيل الموعد. افتح صفحة الموعد للاطلاع على التفاصيل.",
  webPushReportReadyTitle: "Report ready",
  webPushReportReadyBody: "Your report is ready. Open your appointment page for access options.",
  webPushReportReadyTitleAr: "التقرير جاهز",
  webPushReportReadyBodyAr: "تقريرك جاهز. افتح صفحة الموعد للاطلاع على خيارات الوصول.",
  webPushImageReadyTitle: "Images ready",
  webPushImageReadyBody: "Your images are ready. Open your appointment page for access options.",
  webPushImageReadyTitleAr: "الصور جاهزة",
  webPushImageReadyBodyAr: "صورك جاهزة. افتح صفحة الموعد للاطلاع على خيارات الوصول.",
  webPushTestTitle: "Notifications enabled",
  webPushTestBody: "Browser notifications are enabled for this appointment.",
  webPushTestTitleAr: "تم تفعيل التنبيهات",
  webPushTestBodyAr: "تم تفعيل تنبيهات المتصفح لهذا الموعد.",
  whatsappQrLinkMessageAr: "يرجى فتح صفحة الموعد من هنا:\n{link}",
  whatsappQrLinkMessageEn: "Please open your appointment page here:\n{link}",
  whatsappReminderMessageAr: "تذكير: لديك موعد بتاريخ {date}. يرجى فتح صفحة الموعد للاطلاع على التفاصيل:\n{link}",
  whatsappReminderMessageEn: "Reminder: you have an appointment on {date}. Please open your appointment page for details:\n{link}",
  whatsappRescheduledMessageAr: "تم تغيير موعدك. يرجى فتح صفحة الموعد لمعرفة التاريخ والوقت المحدثين:\n{link}",
  whatsappRescheduledMessageEn: "Your appointment has been rescheduled. Please open your appointment page for the updated date and time:\n{link}",
  whatsappChangedMessageAr: "تم تحديث تفاصيل موعدك. يرجى فتح صفحة الموعد لمعرفة آخر المعلومات:\n{link}",
  whatsappChangedMessageEn: "Your appointment details have been updated. Please open your appointment page for the latest information:\n{link}",
  whatsappCancelledMessageAr: "تم إلغاء موعدك. يرجى فتح صفحة الموعد للاطلاع على التفاصيل:\n{link}",
  whatsappCancelledMessageEn: "Your appointment has been cancelled. Please open your appointment page for details:\n{link}",
  pageTitleEn: "Patient QR Service",
  introTextAr: "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة.",
  introTextEn: "You can review appointment details, instructions, and department information from this page.",
  genericPreparationTextAr: "",
  genericPreparationTextEn: "",
  documentsChecklistAr: [
    "ورقة الإحالة",
    "إثبات الهوية",
    "صور أو تقارير سابقة إن وجدت",
    "تحاليل حديثة إذا طُلبت من القسم",
  ],
  documentsChecklistEn: [
    "Referral paper",
    "ID proof",
    "Previous images or reports if available",
    "Recent tests if requested by the department",
  ],
  contact: {
    primaryPhone: "",
    secondaryPhone: "",
    whatsapp: "",
    whatsappEnabled: false,
    workingHoursAr: "",
    workingHoursEn: "",
    noteAr: "",
    noteEn: "",
  },
  location: {
    centerNameAr: "المركز الوطني للأورام بنغازي",
    centerNameEn: "National Cancer Center Benghazi",
    departmentLocationAr: "",
    departmentLocationEn: "",
    roomUnitFloorAr: "",
    roomUnitFloorEn: "",
    addressAr: "",
    addressEn: "",
    arrivalInstructionsAr: "",
    arrivalInstructionsEn: "",
    googleMapsUrl: "",
    parkingNoteAr: "",
    parkingNoteEn: "",
  },
};

export type AppointmentSlipPaperMode = "blank" | "preprinted";
export type AppointmentSlipPaperSize = "a5" | "a4";
export type AppointmentSlipLanguageMode = "ar" | "en" | "bilingual";
export type AppointmentSlipBarcodeValueMode = "accessionNumber" | "appointmentNumber" | "bookingId";
export type AppointmentSlipQrModalityMode = "all" | "include" | "exclude";

export interface AppointmentSlipSettings {
  paperMode: AppointmentSlipPaperMode;
  paperSize: AppointmentSlipPaperSize;
  languageMode: AppointmentSlipLanguageMode;
  safeTopMm: number;
  safeBottomMm: number;
  safeLeftMm: number;
  safeRightMm: number;
  contentPaddingMm: number;
  fontScale: number;
  qrSizeMm: number;
  barcodeHeightMm: number;
  barcodeWidthMm: number;
  hospitalNameAr: string;
  hospitalNameEn: string;
  departmentNameAr: string;
  departmentNameEn: string;
  slipTitleAr: string;
  slipTitleEn: string;
  patientDetailsHeadingAr: string;
  patientDetailsHeadingEn: string;
  appointmentDetailsHeadingAr: string;
  appointmentDetailsHeadingEn: string;
  instructionsHeadingAr: string;
  instructionsHeadingEn: string;
  modalityInstructionsHeadingAr: string;
  modalityInstructionsHeadingEn: string;
  examInstructionsHeadingAr: string;
  examInstructionsHeadingEn: string;
  locationHeadingAr: string;
  locationHeadingEn: string;
  showPatientCategory: boolean;
  showPatientName: boolean;
  showMrn: boolean;
  showNationalId: boolean;
  showPhone: boolean;
  showAgeSex: boolean;
  showAppointmentNumber: boolean;
  showAccessionNumber: boolean;
  showModality: boolean;
  showExamName: boolean;
  showDate: boolean;
  showTime: boolean;
  showWalkIn: boolean;
  showSpecialReason: boolean;
  showLocation: boolean;
  showArrivalNote: boolean;
  boldAppointmentSlipText: boolean;
  showQrCode: boolean;
  qrModalityMode: AppointmentSlipQrModalityMode;
  qrModalityIds: number[];
  qrCaptionAr: string;
  qrCaptionEn: string;
  qrHelperTextAr: string;
  qrHelperTextEn: string;
  showAccessionBarcode: boolean;
  barcodeValueMode: AppointmentSlipBarcodeValueMode;
  barcodeCaptionAr: string;
  barcodeCaptionEn: string;
  showModalityInstructions: boolean;
  showExamSpecificInstructions: boolean;
  maxInstructionLinesOnSlip: number;
  fallbackInstructionTextAr: string;
  fallbackInstructionTextEn: string;
  locationTextAr: string;
  locationTextEn: string;
}

export const DEFAULT_APPOINTMENT_SLIP_SETTINGS: AppointmentSlipSettings = {
  paperMode: "preprinted",
  paperSize: "a5",
  languageMode: "bilingual",
  safeTopMm: 58,
  safeBottomMm: 56,
  safeLeftMm: 10,
  safeRightMm: 10,
  contentPaddingMm: 3,
  fontScale: 1,
  qrSizeMm: 24,
  barcodeHeightMm: 12,
  barcodeWidthMm: 100,
  hospitalNameAr: "المركز الوطني للأورام بنغازي",
  hospitalNameEn: "National Cancer Center Benghazi",
  departmentNameAr: "قسم الأشعة التشخيصية",
  departmentNameEn: "Diagnostic Radiology Department",
  slipTitleAr: "وصل الموعد",
  slipTitleEn: "Appointment Slip",
  patientDetailsHeadingAr: "بيانات المريض",
  patientDetailsHeadingEn: "Patient Details",
  appointmentDetailsHeadingAr: "بيانات الموعد",
  appointmentDetailsHeadingEn: "Appointment Details",
  instructionsHeadingAr: "التعليمات",
  instructionsHeadingEn: "Instructions",
  modalityInstructionsHeadingAr: "تعليمات حسب نوع الجهاز",
  modalityInstructionsHeadingEn: "Modality Instructions",
  examInstructionsHeadingAr: "تعليمات خاصة بالفحص",
  examInstructionsHeadingEn: "Exam Instructions",
  locationHeadingAr: "موقع الفحص",
  locationHeadingEn: "Exam Location",
  showPatientCategory: false,
  showPatientName: true,
  showMrn: true,
  showNationalId: false,
  showPhone: true,
  showAgeSex: true,
  showAppointmentNumber: true,
  showAccessionNumber: true,
  showModality: true,
  showExamName: true,
  showDate: true,
  showTime: true,
  showWalkIn: true,
  showSpecialReason: false,
  showLocation: true,
  showArrivalNote: true,
  boldAppointmentSlipText: false,
  showQrCode: true,
  qrModalityMode: "all",
  qrModalityIds: [],
  qrCaptionAr: "امسح للاطلاع على تفاصيل الموعد",
  qrCaptionEn: "Scan for appointment details",
  qrHelperTextAr: "استخدم الرمز لعرض تعليمات الفحص والموقع وخدمات الموعد.",
  qrHelperTextEn: "Use this QR code to open your appointment page, instructions, and location details.",
  showAccessionBarcode: true,
  barcodeValueMode: "accessionNumber",
  barcodeCaptionAr: "امسح للدخول إلى قائمة الانتظار",
  barcodeCaptionEn: "Scan to Enter The Queue",
  showModalityInstructions: true,
  showExamSpecificInstructions: true,
  maxInstructionLinesOnSlip: 4,
  fallbackInstructionTextAr: "يرجى مسح رمز QR للاطلاع على تعليمات الجهاز والفحص والموقع.",
  fallbackInstructionTextEn: "Scan the QR code for modality instructions, exam-specific instructions, and location details.",
  locationTextAr: "",
  locationTextEn: "",
};


function normalizePatientQrSettings(raw: RawRecord): PatientQrSettings {
  const candidate = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rawValue =
    "setting_value" in candidate
      ? (candidate as RawRecord).setting_value
      : "value" in candidate
        ? (candidate as RawRecord).value
        : candidate;
  const config =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && "value" in rawValue
      ? (rawValue as RawRecord).value
      : rawValue;
  const record = (config && typeof config === "object" && !Array.isArray(config) ? config : {}) as RawRecord;
  const contact = (record.contact && typeof record.contact === "object" && !Array.isArray(record.contact) ? record.contact : {}) as RawRecord;
  const location = (record.location && typeof record.location === "object" && !Array.isArray(record.location) ? record.location : {}) as RawRecord;

  const bool = (value: unknown, fallback: boolean) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "enabled", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "disabled", "no", "off"].includes(normalized)) return false;
    }
    return fallback;
  };
  const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value).trim());
  const mode = (value: unknown): "all" | "include" | "exclude" => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "include" || normalized === "exclude") return normalized;
    return "all";
  };
  const paperMode = (value: unknown): AppointmentSlipPaperMode => (str(value, "blank") === "preprinted" ? "preprinted" : "blank");
  const paperSize = (value: unknown): AppointmentSlipPaperSize => (str(value, "a4") === "a5" ? "a5" : "a4");
  const numArray = (value: unknown): number[] =>
    Array.isArray(value)
      ? value
          .map((item) => Number(item))
          .filter((item, index, list) => Number.isFinite(item) && item > 0 && list.indexOf(item) === index)
      : [];

  return {
    enabled: bool(record.enabled, true),
    risproPublicBaseUrl: str(record.risproPublicBaseUrl, DEFAULT_PATIENT_QR_SETTINGS.risproPublicBaseUrl),
    printQrOnAppointmentSlip: bool(record.printQrOnAppointmentSlip, true),
    qrSlipPaperMode: paperMode(record.qrSlipPaperMode),
    qrSlipPaperSize: paperSize(record.qrSlipPaperSize),
    allowCancellation: bool(record.allowCancellation, true),
    allowAddToCalendar: bool(record.allowAddToCalendar, true),
    publicLinkValidityDays: Number.isInteger(Number(record.publicLinkValidityDays)) ? Number(record.publicLinkValidityDays) : 14,
    showBookingTime: bool(record.showBookingTime, true),
    showPreparationInstructions: bool(record.showPreparationInstructions, true),
    showDocumentsChecklist: bool(record.showDocumentsChecklist, true),
    showDepartmentContact: bool(record.showDepartmentContact, false),
    showLocationDirections: bool(record.showLocationDirections, false),
    allowReportAccess: bool(record.allowReportAccess, false),
    reportAccessModalityMode: mode(record.reportAccessModalityMode),
    reportAccessModalityIds: numArray(record.reportAccessModalityIds),
    allowImageAccess: bool(record.allowImageAccess, false),
    imageAccessModalityMode: mode(record.imageAccessModalityMode),
    imageAccessModalityIds: numArray(record.imageAccessModalityIds),
    showReportPendingCard: bool(record.showReportPendingCard, true),
    reportAccessRequiresCompletedAppointment: bool(record.reportAccessRequiresCompletedAppointment, true),
    imageAccessRequiresCompletedAppointment: bool(record.imageAccessRequiresCompletedAppointment, true),
    imageAccessRequiresReportRequiredFlag: bool(record.imageAccessRequiresReportRequiredFlag, false),
    showReportNotRequiredMessage: bool(record.showReportNotRequiredMessage, false),
    defaultReportRequiredForOncology: bool(record.defaultReportRequiredForOncology, true),
    defaultReportRequiredForNonOncology: bool(record.defaultReportRequiredForNonOncology, false),
    qrReportCheckingMessage: str(record.qrReportCheckingMessage, "Checking report status..."),
    qrReportFinalMessage: str(record.qrReportFinalMessage, "Your report is ready."),
    qrReportDraftMessage: str(record.qrReportDraftMessage, "Your report is still under review and is not finalized yet."),
    qrReportNoReportMessage: str(record.qrReportNoReportMessage, "No report is available for this appointment yet."),
    qrReportUnavailableMessage: str(record.qrReportUnavailableMessage, "The report system is temporarily unavailable. Please try again later."),
    qrReportNotRequiredMessage: str(record.qrReportNotRequiredMessage, ""),
    qrReportNotCompletedMessage: str(record.qrReportNotCompletedMessage, "Report access becomes available after the examination is completed."),
    qrReportCheckButtonLabel: str(record.qrReportCheckButtonLabel, "Check report"),
    qrReportViewButtonLabel: str(record.qrReportViewButtonLabel, "View report"),
    qrImageViewButtonLabel: str(record.qrImageViewButtonLabel, "View images"),
    qrImageUnavailableMessage: str(record.qrImageUnavailableMessage, "Image viewing is currently unavailable. Please try again later."),
    qrReportStudyNotFoundMessage: str(record.qrReportStudyNotFoundMessage, "Your study is not available in the report system yet. Please try again later."),
    qrImageStudyNotFoundMessage: str(record.qrImageStudyNotFoundMessage, "Your study images are not available yet. Please try again later."),
    webPushEnabled: bool(record.webPushEnabled, DEFAULT_PATIENT_QR_SETTINGS.webPushEnabled),
    webPushDefaultReminder24h: bool(record.webPushDefaultReminder24h, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultReminder24h),
    webPushDefaultRescheduled: bool(record.webPushDefaultRescheduled, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultRescheduled),
    webPushDefaultCancelled: bool(record.webPushDefaultCancelled, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultCancelled),
    webPushDefaultChanged: bool(record.webPushDefaultChanged, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultChanged),
    webPushDefaultReportReady: bool(record.webPushDefaultReportReady, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultReportReady),
    webPushDefaultImageReady: bool(record.webPushDefaultImageReady, DEFAULT_PATIENT_QR_SETTINGS.webPushDefaultImageReady),
    webPushCardTitleAr: str(record.webPushCardTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushCardTitleAr),
    webPushCardTitleEn: str(record.webPushCardTitleEn, DEFAULT_PATIENT_QR_SETTINGS.webPushCardTitleEn),
    webPushCardBodyAr: str(record.webPushCardBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushCardBodyAr),
    webPushCardBodyEn: str(record.webPushCardBodyEn, DEFAULT_PATIENT_QR_SETTINGS.webPushCardBodyEn),
    webPushSubscribeButtonAr: str(record.webPushSubscribeButtonAr, DEFAULT_PATIENT_QR_SETTINGS.webPushSubscribeButtonAr),
    webPushSubscribeButtonEn: str(record.webPushSubscribeButtonEn, DEFAULT_PATIENT_QR_SETTINGS.webPushSubscribeButtonEn),
    webPushUnsubscribeButtonAr: str(record.webPushUnsubscribeButtonAr, DEFAULT_PATIENT_QR_SETTINGS.webPushUnsubscribeButtonAr),
    webPushUnsubscribeButtonEn: str(record.webPushUnsubscribeButtonEn, DEFAULT_PATIENT_QR_SETTINGS.webPushUnsubscribeButtonEn),
    webPushTestButtonAr: str(record.webPushTestButtonAr, DEFAULT_PATIENT_QR_SETTINGS.webPushTestButtonAr),
    webPushTestButtonEn: str(record.webPushTestButtonEn, DEFAULT_PATIENT_QR_SETTINGS.webPushTestButtonEn),
    webPushUnsupportedMessageAr: str(record.webPushUnsupportedMessageAr, DEFAULT_PATIENT_QR_SETTINGS.webPushUnsupportedMessageAr),
    webPushUnsupportedMessageEn: str(record.webPushUnsupportedMessageEn, DEFAULT_PATIENT_QR_SETTINGS.webPushUnsupportedMessageEn),
    webPushIosHelpButtonAr: str(record.webPushIosHelpButtonAr, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpButtonAr),
    webPushIosHelpButtonEn: str(record.webPushIosHelpButtonEn, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpButtonEn),
    webPushIosHelpTitleAr: str(record.webPushIosHelpTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpTitleAr),
    webPushIosHelpTitleEn: str(record.webPushIosHelpTitleEn, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpTitleEn),
    webPushIosHelpBodyAr: str(record.webPushIosHelpBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpBodyAr),
    webPushIosHelpBodyEn: str(record.webPushIosHelpBodyEn, DEFAULT_PATIENT_QR_SETTINGS.webPushIosHelpBodyEn),
    webPushDeniedMessageAr: str(record.webPushDeniedMessageAr, DEFAULT_PATIENT_QR_SETTINGS.webPushDeniedMessageAr),
    webPushDeniedMessageEn: str(record.webPushDeniedMessageEn, DEFAULT_PATIENT_QR_SETTINGS.webPushDeniedMessageEn),
    webPushAppointmentReminder24hTitle: str(record.webPushAppointmentReminder24hTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentReminder24hTitle),
    webPushAppointmentReminder24hBody: str(record.webPushAppointmentReminder24hBody, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentReminder24hBody),
    webPushAppointmentReminder24hTitleAr: str(record.webPushAppointmentReminder24hTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentReminder24hTitleAr),
    webPushAppointmentReminder24hBodyAr: str(record.webPushAppointmentReminder24hBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentReminder24hBodyAr),
    webPushAppointmentRescheduledTitle: str(record.webPushAppointmentRescheduledTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentRescheduledTitle),
    webPushAppointmentRescheduledBody: str(record.webPushAppointmentRescheduledBody, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentRescheduledBody),
    webPushAppointmentRescheduledTitleAr: str(record.webPushAppointmentRescheduledTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentRescheduledTitleAr),
    webPushAppointmentRescheduledBodyAr: str(record.webPushAppointmentRescheduledBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentRescheduledBodyAr),
    webPushAppointmentCancelledTitle: str(record.webPushAppointmentCancelledTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentCancelledTitle),
    webPushAppointmentCancelledBody: str(record.webPushAppointmentCancelledBody, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentCancelledBody),
    webPushAppointmentCancelledTitleAr: str(record.webPushAppointmentCancelledTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentCancelledTitleAr),
    webPushAppointmentCancelledBodyAr: str(record.webPushAppointmentCancelledBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentCancelledBodyAr),
    webPushAppointmentChangedTitle: str(record.webPushAppointmentChangedTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentChangedTitle),
    webPushAppointmentChangedBody: str(record.webPushAppointmentChangedBody, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentChangedBody),
    webPushAppointmentChangedTitleAr: str(record.webPushAppointmentChangedTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentChangedTitleAr),
    webPushAppointmentChangedBodyAr: str(record.webPushAppointmentChangedBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushAppointmentChangedBodyAr),
    webPushReportReadyTitle: str(record.webPushReportReadyTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushReportReadyTitle),
    webPushReportReadyBody: str(record.webPushReportReadyBody, DEFAULT_PATIENT_QR_SETTINGS.webPushReportReadyBody),
    webPushReportReadyTitleAr: str(record.webPushReportReadyTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushReportReadyTitleAr),
    webPushReportReadyBodyAr: str(record.webPushReportReadyBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushReportReadyBodyAr),
    webPushImageReadyTitle: str(record.webPushImageReadyTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushImageReadyTitle),
    webPushImageReadyBody: str(record.webPushImageReadyBody, DEFAULT_PATIENT_QR_SETTINGS.webPushImageReadyBody),
    webPushImageReadyTitleAr: str(record.webPushImageReadyTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushImageReadyTitleAr),
    webPushImageReadyBodyAr: str(record.webPushImageReadyBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushImageReadyBodyAr),
    webPushTestTitle: str(record.webPushTestTitle, DEFAULT_PATIENT_QR_SETTINGS.webPushTestTitle),
    webPushTestBody: str(record.webPushTestBody, DEFAULT_PATIENT_QR_SETTINGS.webPushTestBody),
    webPushTestTitleAr: str(record.webPushTestTitleAr, DEFAULT_PATIENT_QR_SETTINGS.webPushTestTitleAr),
    webPushTestBodyAr: str(record.webPushTestBodyAr, DEFAULT_PATIENT_QR_SETTINGS.webPushTestBodyAr),
    whatsappQrLinkMessageAr: str(record.whatsappQrLinkMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappQrLinkMessageAr),
    whatsappQrLinkMessageEn: str(record.whatsappQrLinkMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappQrLinkMessageEn),
    whatsappReminderMessageAr: str(record.whatsappReminderMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappReminderMessageAr),
    whatsappReminderMessageEn: str(record.whatsappReminderMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappReminderMessageEn),
    whatsappRescheduledMessageAr: str(record.whatsappRescheduledMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappRescheduledMessageAr),
    whatsappRescheduledMessageEn: str(record.whatsappRescheduledMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappRescheduledMessageEn),
    whatsappChangedMessageAr: str(record.whatsappChangedMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappChangedMessageAr),
    whatsappChangedMessageEn: str(record.whatsappChangedMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappChangedMessageEn),
    whatsappCancelledMessageAr: str(record.whatsappCancelledMessageAr, DEFAULT_PATIENT_QR_SETTINGS.whatsappCancelledMessageAr),
    whatsappCancelledMessageEn: str(record.whatsappCancelledMessageEn, DEFAULT_PATIENT_QR_SETTINGS.whatsappCancelledMessageEn),
    pageTitleAr: str(record.pageTitleAr, DEFAULT_PATIENT_QR_SETTINGS.pageTitleAr),
    pageTitleEn: str(record.pageTitleEn, DEFAULT_PATIENT_QR_SETTINGS.pageTitleEn),
    introTextAr: str(record.introTextAr, DEFAULT_PATIENT_QR_SETTINGS.introTextAr),
    introTextEn: str(record.introTextEn, DEFAULT_PATIENT_QR_SETTINGS.introTextEn),
    genericPreparationTextAr: str(record.genericPreparationTextAr, ""),
    genericPreparationTextEn: str(record.genericPreparationTextEn, ""),
    documentsChecklistAr: Array.isArray(record.documentsChecklistAr)
      ? record.documentsChecklistAr.map((item) => String(item).trim()).filter(Boolean)
      : [],
    documentsChecklistEn: Array.isArray(record.documentsChecklistEn)
      ? record.documentsChecklistEn.map((item) => String(item).trim()).filter(Boolean)
      : [],
    contact: {
      primaryPhone: str(contact.primaryPhone, ""),
      secondaryPhone: str(contact.secondaryPhone, ""),
      whatsapp: str(contact.whatsapp, ""),
      whatsappEnabled: bool(contact.whatsappEnabled, false),
      workingHoursAr: str(contact.workingHoursAr, ""),
      workingHoursEn: str(contact.workingHoursEn, ""),
      noteAr: str(contact.noteAr, ""),
      noteEn: str(contact.noteEn, ""),
    },
    location: {
      centerNameAr: str(location.centerNameAr, DEFAULT_PATIENT_QR_SETTINGS.location.centerNameAr),
      centerNameEn: str(location.centerNameEn, DEFAULT_PATIENT_QR_SETTINGS.location.centerNameEn),
      departmentLocationAr: str(location.departmentLocationAr, ""),
      departmentLocationEn: str(location.departmentLocationEn, ""),
      roomUnitFloorAr: str(location.roomUnitFloorAr, ""),
      roomUnitFloorEn: str(location.roomUnitFloorEn, ""),
      addressAr: str(location.addressAr, ""),
      addressEn: str(location.addressEn, ""),
      arrivalInstructionsAr: str(location.arrivalInstructionsAr, ""),
      arrivalInstructionsEn: str(location.arrivalInstructionsEn, ""),
      googleMapsUrl: str(location.googleMapsUrl, ""),
      parkingNoteAr: str(location.parkingNoteAr, ""),
      parkingNoteEn: str(location.parkingNoteEn, ""),
    },
  };
}

function normalizeAppointmentSlipSettings(raw: RawRecord): AppointmentSlipSettings {
  const candidate = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rawValue =
    "setting_value" in candidate
      ? (candidate as RawRecord).setting_value
      : "value" in candidate
        ? (candidate as RawRecord).value
        : candidate;
  const config =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) && "value" in rawValue
      ? (rawValue as RawRecord).value
      : rawValue;
  const record = (config && typeof config === "object" && !Array.isArray(config) ? config : {}) as RawRecord;

  const bool = (value: unknown, fallback: boolean) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "enabled", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "disabled", "no", "off"].includes(normalized)) return false;
    }
    return fallback;
  };
  const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value).trim());
  const num = (value: unknown, fallback: number, min?: number, max?: number) => {
    const raw = typeof value === "number" ? String(value) : String(value ?? "").trim();
    if (!raw) return fallback;
    const parsed = typeof value === "number" ? value : Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    let next = parsed;
    if (typeof min === "number" && next < min) next = min;
    if (typeof max === "number" && next > max) next = max;
    return next;
  };

  const paperMode = str(record.paperMode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.paperMode);
  const paperSize = str(record.paperSize, DEFAULT_APPOINTMENT_SLIP_SETTINGS.paperSize);
  const languageMode = str(record.languageMode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.languageMode);
  const barcodeValueMode = str(record.barcodeValueMode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeValueMode);
  const qrModalityMode = str(record.qrModalityMode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrModalityMode);
  const qrModalityIds = Array.isArray(record.qrModalityIds)
    ? record.qrModalityIds
        .map((value) => Number(value))
        .filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index)
    : [];

  return {
    paperMode: paperMode === "blank" ? "blank" : "preprinted",
    paperSize: paperSize === "a4" ? "a4" : "a5",
    languageMode: languageMode === "ar" || languageMode === "en" ? languageMode : "bilingual",
    safeTopMm: num(record.safeTopMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.safeTopMm, 0, 120),
    safeBottomMm: num(record.safeBottomMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.safeBottomMm, 0, 120),
    safeLeftMm: num(record.safeLeftMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.safeLeftMm, 0, 80),
    safeRightMm: num(record.safeRightMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.safeRightMm, 0, 80),
    contentPaddingMm: num(record.contentPaddingMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.contentPaddingMm, 0, 20),
    fontScale: num(record.fontScale, DEFAULT_APPOINTMENT_SLIP_SETTINGS.fontScale, 0.7, 1.6),
    qrSizeMm: num(record.qrSizeMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrSizeMm, 12, 48),
    barcodeHeightMm: num(record.barcodeHeightMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeHeightMm, 6, 28),
    barcodeWidthMm: num(record.barcodeWidthMm, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeWidthMm, 40, 130),
    /* legacy literal fallback removed; use centralized defaults */
    hospitalNameAr: str(record.hospitalNameAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.hospitalNameAr),
    hospitalNameEn: str(record.hospitalNameEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.hospitalNameEn),
    departmentNameAr: str(record.departmentNameAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.departmentNameAr),
    departmentNameEn: str(record.departmentNameEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.departmentNameEn),
    slipTitleAr: str(record.slipTitleAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.slipTitleAr),
    slipTitleEn: str(record.slipTitleEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.slipTitleEn),
    patientDetailsHeadingAr: str(record.patientDetailsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.patientDetailsHeadingAr),
    patientDetailsHeadingEn: str(record.patientDetailsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.patientDetailsHeadingEn),
    appointmentDetailsHeadingAr: str(record.appointmentDetailsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.appointmentDetailsHeadingAr),
    appointmentDetailsHeadingEn: str(record.appointmentDetailsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.appointmentDetailsHeadingEn),
    instructionsHeadingAr: str(record.instructionsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.instructionsHeadingAr),
    instructionsHeadingEn: str(record.instructionsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.instructionsHeadingEn),
    modalityInstructionsHeadingAr: str(record.modalityInstructionsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.modalityInstructionsHeadingAr),
    modalityInstructionsHeadingEn: str(record.modalityInstructionsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.modalityInstructionsHeadingEn),
    examInstructionsHeadingAr: str(record.examInstructionsHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.examInstructionsHeadingAr),
    examInstructionsHeadingEn: str(record.examInstructionsHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.examInstructionsHeadingEn),
    locationHeadingAr: str(record.locationHeadingAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.locationHeadingAr),
    locationHeadingEn: str(record.locationHeadingEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.locationHeadingEn),
    showPatientCategory: bool(record.showPatientCategory, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showPatientCategory),
    showPatientName: bool(record.showPatientName, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showPatientName),
    showMrn: bool(record.showMrn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showMrn),
    showNationalId: bool(record.showNationalId, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showNationalId),
    showPhone: bool(record.showPhone, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showPhone),
    showAgeSex: bool(record.showAgeSex, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showAgeSex),
    showAppointmentNumber: bool(record.showAppointmentNumber, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showAppointmentNumber),
    showAccessionNumber: bool(record.showAccessionNumber, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showAccessionNumber),
    showModality: bool(record.showModality, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showModality),
    showExamName: bool(record.showExamName, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showExamName),
    showDate: bool(record.showDate, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showDate),
    showTime: bool(record.showTime, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showTime),
    showWalkIn: bool(record.showWalkIn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showWalkIn),
    showSpecialReason: bool(record.showSpecialReason, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showSpecialReason),
    showLocation: bool(record.showLocation, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showLocation),
    showArrivalNote: bool(record.showArrivalNote, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showArrivalNote),
    boldAppointmentSlipText: bool(record.boldAppointmentSlipText, DEFAULT_APPOINTMENT_SLIP_SETTINGS.boldAppointmentSlipText),
    showQrCode: bool(record.showQrCode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showQrCode),
    qrModalityMode: qrModalityMode === "include" || qrModalityMode === "exclude" ? qrModalityMode : "all",
    qrModalityIds,
    qrCaptionAr: str(record.qrCaptionAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrCaptionAr),
    qrCaptionEn: str(record.qrCaptionEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrCaptionEn),
    qrHelperTextAr: str(record.qrHelperTextAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrHelperTextAr),
    qrHelperTextEn: str(record.qrHelperTextEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.qrHelperTextEn),
    showAccessionBarcode: bool(record.showAccessionBarcode, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showAccessionBarcode),
    barcodeValueMode:
      barcodeValueMode === "appointmentNumber" || barcodeValueMode === "bookingId" ? barcodeValueMode : "accessionNumber",
    barcodeCaptionAr: str(record.barcodeCaptionAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeCaptionAr),
    barcodeCaptionEn: str(record.barcodeCaptionEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.barcodeCaptionEn),
    showModalityInstructions: bool(record.showModalityInstructions, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showModalityInstructions),
    showExamSpecificInstructions: bool(record.showExamSpecificInstructions, DEFAULT_APPOINTMENT_SLIP_SETTINGS.showExamSpecificInstructions),
    maxInstructionLinesOnSlip: num(record.maxInstructionLinesOnSlip, DEFAULT_APPOINTMENT_SLIP_SETTINGS.maxInstructionLinesOnSlip, 1, 8),
    fallbackInstructionTextAr: str(record.fallbackInstructionTextAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.fallbackInstructionTextAr),
    fallbackInstructionTextEn: str(record.fallbackInstructionTextEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.fallbackInstructionTextEn),
    locationTextAr: str(record.locationTextAr, DEFAULT_APPOINTMENT_SLIP_SETTINGS.locationTextAr),
    locationTextEn: str(record.locationTextEn, DEFAULT_APPOINTMENT_SLIP_SETTINGS.locationTextEn),
  };
}

function looksLikeMojibake(value: string): boolean {
  return /Ã|Â|Ø|Ù|ï¿½|þ/.test(value);
}

function sanitizePatientQrTextEncoding(settings: PatientQrSettings): PatientQrSettings {
  const fixed: PatientQrSettings = {
    ...settings,
    contact: { ...settings.contact },
    location: { ...settings.location },
  };

  const sanitize = (value: string, fallback: string): string =>
    looksLikeMojibake(String(value ?? "")) ? fallback : value;

  fixed.pageTitleAr = sanitize(fixed.pageTitleAr, DEFAULT_PATIENT_QR_SETTINGS.pageTitleAr);
  fixed.introTextAr = sanitize(fixed.introTextAr, DEFAULT_PATIENT_QR_SETTINGS.introTextAr);
  fixed.location.centerNameAr = sanitize(
    fixed.location.centerNameAr,
    DEFAULT_PATIENT_QR_SETTINGS.location.centerNameAr
  );

  fixed.documentsChecklistAr = (fixed.documentsChecklistAr ?? []).map((item, index) =>
    sanitize(item, DEFAULT_PATIENT_QR_SETTINGS.documentsChecklistAr[index] ?? item)
  );

  return fixed;
}

function sanitizeAppointmentSlipTextEncoding(settings: AppointmentSlipSettings): AppointmentSlipSettings {
  const fixed = { ...settings };
  const keys: Array<keyof AppointmentSlipSettings> = [
    "hospitalNameAr",
    "departmentNameAr",
    "slipTitleAr",
    "patientDetailsHeadingAr",
    "appointmentDetailsHeadingAr",
    "instructionsHeadingAr",
    "modalityInstructionsHeadingAr",
    "examInstructionsHeadingAr",
    "locationHeadingAr",
    "qrCaptionAr",
    "qrHelperTextAr",
    "barcodeCaptionAr",
    "fallbackInstructionTextAr",
    "locationTextAr",
  ];
  for (const key of keys) {
    const value = String(fixed[key] ?? "");
    if (looksLikeMojibake(value)) {
      fixed[key] = DEFAULT_APPOINTMENT_SLIP_SETTINGS[key] as never;
    }
  }
  return fixed;
}

export async function fetchPatientQrSettings(): Promise<PatientQrSettings> {
  const response = await api<{ settings: RawRecord[] }>("/settings/patient_qr_self_service");
  const configRow = response.settings?.find((row) => row.setting_key === "config");
  return sanitizePatientQrTextEncoding(normalizePatientQrSettings(configRow ?? {}));
}

export async function savePatientQrSettings(payload: PatientQrSettings) {
  const result = await api<RawRecord>("/settings/patient_qr_self_service", {
    method: "PUT",
    body: JSON.stringify({
      entries: [{ key: "config", value: payload }],
    }),
  });
  if (payload.webPushEnabled) {
    await api<RawRecord>("/settings/patient-web-push/ensure-config", {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
  return result;
}

export async function fetchAppointmentSlipSettings(): Promise<AppointmentSlipSettings> {
  const response = await api<{ settings: RawRecord[] }>("/settings/appointment_slip");
  const configRow = response.settings?.find((row) => row.setting_key === "config");
  const normalized = sanitizeAppointmentSlipTextEncoding(normalizeAppointmentSlipSettings(configRow ?? {}));
  return {
    ...DEFAULT_APPOINTMENT_SLIP_SETTINGS,
    ...normalized,
  };
}

export async function saveAppointmentSlipSettings(payload: AppointmentSlipSettings) {
  return api<RawRecord>("/settings/appointment_slip", {
    method: "PUT",
    body: JSON.stringify({
      entries: [{ key: "config", value: payload }],
    }),
  });
}

export async function updateAppointment(id: number, payload: RawRecord) {
  await api<{ booking: RawRecord }>(`/v2/appointments/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  const details = await api<{ appointment: RawRecord }>(`/v2/read/appointments/${id}`);
  return mapAppointmentWithDetails(details.appointment);
}

export async function cancelAppointment(id: number, _cancelReason: string) {
  void _cancelReason;
  const raw = await api<{ booking: RawRecord; previousStatus: string }>(`/v2/appointments/${id}/cancel`, {
    method: "POST"
  });
  return { appointment: raw.booking };
}

export async function deleteAppointment(id: number, voidReason: string) {
  await api<{ booking: RawRecord; previousStatus: string }>(`/v2/appointments/${id}/void`, {
    method: "POST",
    body: JSON.stringify({ voidReason })
  });
  return { ok: true };
}

export async function sendPatientWebPushNotification(
  id: number,
  payload: { title?: string; message?: string; templateEventType?: string }
) {
  return api<{ eventId: number | null; created: boolean }>(`/v2/appointments/${id}/patient-notification`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
