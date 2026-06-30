import { getSettingsByCategory } from "../../../../services/settings-service.js";

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
  qrSlipPaperMode: "blank" | "preprinted";
  qrSlipPaperSize: "a5" | "a4";
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

const DEFAULT_SETTINGS: PatientQrSettings = {
  enabled: true,
  risproPublicBaseUrl: "",
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

function readRawValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "enabled", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "disabled", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value).trim();
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [...fallback];
}

function asMode(value: unknown, fallback: "all" | "include" | "exclude"): "all" | "include" | "exclude" {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "include" || raw === "exclude") return raw;
  if (raw === "all") return "all";
  return fallback;
}

function asPaperMode(value: unknown, fallback: "blank" | "preprinted"): "blank" | "preprinted" {
  return asString(value, fallback) === "preprinted" ? "preprinted" : "blank";
}

function asPaperSize(value: unknown, fallback: "a5" | "a4"): "a5" | "a4" {
  return asString(value, fallback) === "a5" ? "a5" : "a4";
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item, index, arr) => Number.isFinite(item) && item > 0 && arr.indexOf(item) === index);
}

function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function isModalityAllowed(
  mode: "all" | "include" | "exclude",
  modalityIds: number[],
  modalityId: number | null | undefined
): boolean {
  if (mode === "all") return true;
  const id = Number(modalityId);
  if (!Number.isFinite(id) || id <= 0) return mode === "exclude";
  const selected = new Set(asNumberArray(modalityIds));
  if (mode === "include") return selected.has(id);
  if (mode === "exclude") return !selected.has(id);
  return true;
}

export function normalizePatientQrSettings(raw: unknown): PatientQrSettings {
  const record = (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const contactRaw = (record.contact && typeof record.contact === "object" && !Array.isArray(record.contact) ? (record.contact as Record<string, unknown>) : {}) as Record<string, unknown>;
  const locationRaw = (record.location && typeof record.location === "object" && !Array.isArray(record.location) ? (record.location as Record<string, unknown>) : {}) as Record<string, unknown>;

  return {
    enabled: asBoolean(record.enabled, DEFAULT_SETTINGS.enabled),
    risproPublicBaseUrl: asString(record.risproPublicBaseUrl, DEFAULT_SETTINGS.risproPublicBaseUrl),
    printQrOnAppointmentSlip: asBoolean(record.printQrOnAppointmentSlip, DEFAULT_SETTINGS.printQrOnAppointmentSlip),
    qrSlipPaperMode: asPaperMode(record.qrSlipPaperMode, DEFAULT_SETTINGS.qrSlipPaperMode),
    qrSlipPaperSize: asPaperSize(record.qrSlipPaperSize, DEFAULT_SETTINGS.qrSlipPaperSize),
    allowCancellation: asBoolean(record.allowCancellation, DEFAULT_SETTINGS.allowCancellation),
    allowAddToCalendar: asBoolean(record.allowAddToCalendar, DEFAULT_SETTINGS.allowAddToCalendar),
    publicLinkValidityDays: asInteger(record.publicLinkValidityDays, DEFAULT_SETTINGS.publicLinkValidityDays, 0, 3650),
    showBookingTime: asBoolean(record.showBookingTime, DEFAULT_SETTINGS.showBookingTime),
    showPreparationInstructions: asBoolean(record.showPreparationInstructions, DEFAULT_SETTINGS.showPreparationInstructions),
    showDocumentsChecklist: asBoolean(record.showDocumentsChecklist, DEFAULT_SETTINGS.showDocumentsChecklist),
    showDepartmentContact: asBoolean(record.showDepartmentContact, DEFAULT_SETTINGS.showDepartmentContact),
    showLocationDirections: asBoolean(record.showLocationDirections, DEFAULT_SETTINGS.showLocationDirections),
    allowReportAccess: asBoolean(record.allowReportAccess, DEFAULT_SETTINGS.allowReportAccess),
    reportAccessModalityMode: asMode(record.reportAccessModalityMode, DEFAULT_SETTINGS.reportAccessModalityMode),
    reportAccessModalityIds: asNumberArray(record.reportAccessModalityIds),
    allowImageAccess: asBoolean(record.allowImageAccess, DEFAULT_SETTINGS.allowImageAccess),
    imageAccessModalityMode: asMode(record.imageAccessModalityMode, DEFAULT_SETTINGS.imageAccessModalityMode),
    imageAccessModalityIds: asNumberArray(record.imageAccessModalityIds),
    showReportPendingCard: asBoolean(record.showReportPendingCard, DEFAULT_SETTINGS.showReportPendingCard),
    reportAccessRequiresCompletedAppointment: asBoolean(record.reportAccessRequiresCompletedAppointment, DEFAULT_SETTINGS.reportAccessRequiresCompletedAppointment),
    imageAccessRequiresCompletedAppointment: asBoolean(record.imageAccessRequiresCompletedAppointment, DEFAULT_SETTINGS.imageAccessRequiresCompletedAppointment),
    imageAccessRequiresReportRequiredFlag: asBoolean(record.imageAccessRequiresReportRequiredFlag, DEFAULT_SETTINGS.imageAccessRequiresReportRequiredFlag),
    showReportNotRequiredMessage: asBoolean(record.showReportNotRequiredMessage, DEFAULT_SETTINGS.showReportNotRequiredMessage),
    defaultReportRequiredForOncology: asBoolean(record.defaultReportRequiredForOncology, DEFAULT_SETTINGS.defaultReportRequiredForOncology),
    defaultReportRequiredForNonOncology: asBoolean(record.defaultReportRequiredForNonOncology, DEFAULT_SETTINGS.defaultReportRequiredForNonOncology),
    qrReportCheckingMessage: asString(record.qrReportCheckingMessage, DEFAULT_SETTINGS.qrReportCheckingMessage),
    qrReportFinalMessage: asString(record.qrReportFinalMessage, DEFAULT_SETTINGS.qrReportFinalMessage),
    qrReportDraftMessage: asString(record.qrReportDraftMessage, DEFAULT_SETTINGS.qrReportDraftMessage),
    qrReportNoReportMessage: asString(record.qrReportNoReportMessage, DEFAULT_SETTINGS.qrReportNoReportMessage),
    qrReportUnavailableMessage: asString(record.qrReportUnavailableMessage, DEFAULT_SETTINGS.qrReportUnavailableMessage),
    qrReportNotRequiredMessage: asString(record.qrReportNotRequiredMessage, DEFAULT_SETTINGS.qrReportNotRequiredMessage),
    qrReportNotCompletedMessage: asString(record.qrReportNotCompletedMessage, DEFAULT_SETTINGS.qrReportNotCompletedMessage),
    qrReportCheckButtonLabel: asString(record.qrReportCheckButtonLabel, DEFAULT_SETTINGS.qrReportCheckButtonLabel),
    qrReportViewButtonLabel: asString(record.qrReportViewButtonLabel, DEFAULT_SETTINGS.qrReportViewButtonLabel),
    qrImageViewButtonLabel: asString(record.qrImageViewButtonLabel, DEFAULT_SETTINGS.qrImageViewButtonLabel),
    qrImageUnavailableMessage: asString(record.qrImageUnavailableMessage, DEFAULT_SETTINGS.qrImageUnavailableMessage),
    qrReportStudyNotFoundMessage: asString(record.qrReportStudyNotFoundMessage, DEFAULT_SETTINGS.qrReportStudyNotFoundMessage),
    qrImageStudyNotFoundMessage: asString(record.qrImageStudyNotFoundMessage, DEFAULT_SETTINGS.qrImageStudyNotFoundMessage),
    webPushEnabled: asBoolean(record.webPushEnabled, DEFAULT_SETTINGS.webPushEnabled),
    webPushDefaultReminder24h: asBoolean(record.webPushDefaultReminder24h, DEFAULT_SETTINGS.webPushDefaultReminder24h),
    webPushDefaultRescheduled: asBoolean(record.webPushDefaultRescheduled, DEFAULT_SETTINGS.webPushDefaultRescheduled),
    webPushDefaultCancelled: asBoolean(record.webPushDefaultCancelled, DEFAULT_SETTINGS.webPushDefaultCancelled),
    webPushDefaultChanged: asBoolean(record.webPushDefaultChanged, DEFAULT_SETTINGS.webPushDefaultChanged),
    webPushDefaultReportReady: asBoolean(record.webPushDefaultReportReady, DEFAULT_SETTINGS.webPushDefaultReportReady),
    webPushDefaultImageReady: asBoolean(record.webPushDefaultImageReady, DEFAULT_SETTINGS.webPushDefaultImageReady),
    webPushCardTitleAr: asString(record.webPushCardTitleAr, DEFAULT_SETTINGS.webPushCardTitleAr),
    webPushCardTitleEn: asString(record.webPushCardTitleEn, DEFAULT_SETTINGS.webPushCardTitleEn),
    webPushCardBodyAr: asString(record.webPushCardBodyAr, DEFAULT_SETTINGS.webPushCardBodyAr),
    webPushCardBodyEn: asString(record.webPushCardBodyEn, DEFAULT_SETTINGS.webPushCardBodyEn),
    webPushSubscribeButtonAr: asString(record.webPushSubscribeButtonAr, DEFAULT_SETTINGS.webPushSubscribeButtonAr),
    webPushSubscribeButtonEn: asString(record.webPushSubscribeButtonEn, DEFAULT_SETTINGS.webPushSubscribeButtonEn),
    webPushUnsubscribeButtonAr: asString(record.webPushUnsubscribeButtonAr, DEFAULT_SETTINGS.webPushUnsubscribeButtonAr),
    webPushUnsubscribeButtonEn: asString(record.webPushUnsubscribeButtonEn, DEFAULT_SETTINGS.webPushUnsubscribeButtonEn),
    webPushTestButtonAr: asString(record.webPushTestButtonAr, DEFAULT_SETTINGS.webPushTestButtonAr),
    webPushTestButtonEn: asString(record.webPushTestButtonEn, DEFAULT_SETTINGS.webPushTestButtonEn),
    webPushUnsupportedMessageAr: asString(record.webPushUnsupportedMessageAr, DEFAULT_SETTINGS.webPushUnsupportedMessageAr),
    webPushUnsupportedMessageEn: asString(record.webPushUnsupportedMessageEn, DEFAULT_SETTINGS.webPushUnsupportedMessageEn),
    webPushIosHelpButtonAr: asString(record.webPushIosHelpButtonAr, DEFAULT_SETTINGS.webPushIosHelpButtonAr),
    webPushIosHelpButtonEn: asString(record.webPushIosHelpButtonEn, DEFAULT_SETTINGS.webPushIosHelpButtonEn),
    webPushIosHelpTitleAr: asString(record.webPushIosHelpTitleAr, DEFAULT_SETTINGS.webPushIosHelpTitleAr),
    webPushIosHelpTitleEn: asString(record.webPushIosHelpTitleEn, DEFAULT_SETTINGS.webPushIosHelpTitleEn),
    webPushIosHelpBodyAr: asString(record.webPushIosHelpBodyAr, DEFAULT_SETTINGS.webPushIosHelpBodyAr),
    webPushIosHelpBodyEn: asString(record.webPushIosHelpBodyEn, DEFAULT_SETTINGS.webPushIosHelpBodyEn),
    webPushDeniedMessageAr: asString(record.webPushDeniedMessageAr, DEFAULT_SETTINGS.webPushDeniedMessageAr),
    webPushDeniedMessageEn: asString(record.webPushDeniedMessageEn, DEFAULT_SETTINGS.webPushDeniedMessageEn),
    webPushAppointmentReminder24hTitle: asString(record.webPushAppointmentReminder24hTitle, DEFAULT_SETTINGS.webPushAppointmentReminder24hTitle),
    webPushAppointmentReminder24hBody: asString(record.webPushAppointmentReminder24hBody, DEFAULT_SETTINGS.webPushAppointmentReminder24hBody),
    webPushAppointmentReminder24hTitleAr: asString(record.webPushAppointmentReminder24hTitleAr, DEFAULT_SETTINGS.webPushAppointmentReminder24hTitleAr),
    webPushAppointmentReminder24hBodyAr: asString(record.webPushAppointmentReminder24hBodyAr, DEFAULT_SETTINGS.webPushAppointmentReminder24hBodyAr),
    webPushAppointmentRescheduledTitle: asString(record.webPushAppointmentRescheduledTitle, DEFAULT_SETTINGS.webPushAppointmentRescheduledTitle),
    webPushAppointmentRescheduledBody: asString(record.webPushAppointmentRescheduledBody, DEFAULT_SETTINGS.webPushAppointmentRescheduledBody),
    webPushAppointmentRescheduledTitleAr: asString(record.webPushAppointmentRescheduledTitleAr, DEFAULT_SETTINGS.webPushAppointmentRescheduledTitleAr),
    webPushAppointmentRescheduledBodyAr: asString(record.webPushAppointmentRescheduledBodyAr, DEFAULT_SETTINGS.webPushAppointmentRescheduledBodyAr),
    webPushAppointmentCancelledTitle: asString(record.webPushAppointmentCancelledTitle, DEFAULT_SETTINGS.webPushAppointmentCancelledTitle),
    webPushAppointmentCancelledBody: asString(record.webPushAppointmentCancelledBody, DEFAULT_SETTINGS.webPushAppointmentCancelledBody),
    webPushAppointmentCancelledTitleAr: asString(record.webPushAppointmentCancelledTitleAr, DEFAULT_SETTINGS.webPushAppointmentCancelledTitleAr),
    webPushAppointmentCancelledBodyAr: asString(record.webPushAppointmentCancelledBodyAr, DEFAULT_SETTINGS.webPushAppointmentCancelledBodyAr),
    webPushAppointmentChangedTitle: asString(record.webPushAppointmentChangedTitle, DEFAULT_SETTINGS.webPushAppointmentChangedTitle),
    webPushAppointmentChangedBody: asString(record.webPushAppointmentChangedBody, DEFAULT_SETTINGS.webPushAppointmentChangedBody),
    webPushAppointmentChangedTitleAr: asString(record.webPushAppointmentChangedTitleAr, DEFAULT_SETTINGS.webPushAppointmentChangedTitleAr),
    webPushAppointmentChangedBodyAr: asString(record.webPushAppointmentChangedBodyAr, DEFAULT_SETTINGS.webPushAppointmentChangedBodyAr),
    webPushReportReadyTitle: asString(record.webPushReportReadyTitle, DEFAULT_SETTINGS.webPushReportReadyTitle),
    webPushReportReadyBody: asString(record.webPushReportReadyBody, DEFAULT_SETTINGS.webPushReportReadyBody),
    webPushReportReadyTitleAr: asString(record.webPushReportReadyTitleAr, DEFAULT_SETTINGS.webPushReportReadyTitleAr),
    webPushReportReadyBodyAr: asString(record.webPushReportReadyBodyAr, DEFAULT_SETTINGS.webPushReportReadyBodyAr),
    webPushImageReadyTitle: asString(record.webPushImageReadyTitle, DEFAULT_SETTINGS.webPushImageReadyTitle),
    webPushImageReadyBody: asString(record.webPushImageReadyBody, DEFAULT_SETTINGS.webPushImageReadyBody),
    webPushImageReadyTitleAr: asString(record.webPushImageReadyTitleAr, DEFAULT_SETTINGS.webPushImageReadyTitleAr),
    webPushImageReadyBodyAr: asString(record.webPushImageReadyBodyAr, DEFAULT_SETTINGS.webPushImageReadyBodyAr),
    webPushTestTitle: asString(record.webPushTestTitle, DEFAULT_SETTINGS.webPushTestTitle),
    webPushTestBody: asString(record.webPushTestBody, DEFAULT_SETTINGS.webPushTestBody),
    webPushTestTitleAr: asString(record.webPushTestTitleAr, DEFAULT_SETTINGS.webPushTestTitleAr),
    webPushTestBodyAr: asString(record.webPushTestBodyAr, DEFAULT_SETTINGS.webPushTestBodyAr),
    whatsappQrLinkMessageAr: asString(record.whatsappQrLinkMessageAr, DEFAULT_SETTINGS.whatsappQrLinkMessageAr),
    whatsappQrLinkMessageEn: asString(record.whatsappQrLinkMessageEn, DEFAULT_SETTINGS.whatsappQrLinkMessageEn),
    whatsappReminderMessageAr: asString(record.whatsappReminderMessageAr, DEFAULT_SETTINGS.whatsappReminderMessageAr),
    whatsappReminderMessageEn: asString(record.whatsappReminderMessageEn, DEFAULT_SETTINGS.whatsappReminderMessageEn),
    whatsappRescheduledMessageAr: asString(record.whatsappRescheduledMessageAr, DEFAULT_SETTINGS.whatsappRescheduledMessageAr),
    whatsappRescheduledMessageEn: asString(record.whatsappRescheduledMessageEn, DEFAULT_SETTINGS.whatsappRescheduledMessageEn),
    whatsappChangedMessageAr: asString(record.whatsappChangedMessageAr, DEFAULT_SETTINGS.whatsappChangedMessageAr),
    whatsappChangedMessageEn: asString(record.whatsappChangedMessageEn, DEFAULT_SETTINGS.whatsappChangedMessageEn),
    whatsappCancelledMessageAr: asString(record.whatsappCancelledMessageAr, DEFAULT_SETTINGS.whatsappCancelledMessageAr),
    whatsappCancelledMessageEn: asString(record.whatsappCancelledMessageEn, DEFAULT_SETTINGS.whatsappCancelledMessageEn),
    pageTitleAr: asString(record.pageTitleAr, DEFAULT_SETTINGS.pageTitleAr),
    pageTitleEn: asString(record.pageTitleEn, DEFAULT_SETTINGS.pageTitleEn),
    introTextAr: asString(record.introTextAr, DEFAULT_SETTINGS.introTextAr),
    introTextEn: asString(record.introTextEn, DEFAULT_SETTINGS.introTextEn),
    genericPreparationTextAr: asString(record.genericPreparationTextAr, DEFAULT_SETTINGS.genericPreparationTextAr),
    genericPreparationTextEn: asString(record.genericPreparationTextEn, DEFAULT_SETTINGS.genericPreparationTextEn),
    documentsChecklistAr: asStringArray(record.documentsChecklistAr, DEFAULT_SETTINGS.documentsChecklistAr),
    documentsChecklistEn: asStringArray(record.documentsChecklistEn, DEFAULT_SETTINGS.documentsChecklistEn),
    contact: {
      primaryPhone: asString(contactRaw.primaryPhone, DEFAULT_SETTINGS.contact.primaryPhone),
      secondaryPhone: asString(contactRaw.secondaryPhone, DEFAULT_SETTINGS.contact.secondaryPhone),
      whatsapp: asString(contactRaw.whatsapp, DEFAULT_SETTINGS.contact.whatsapp),
      whatsappEnabled: asBoolean(contactRaw.whatsappEnabled, DEFAULT_SETTINGS.contact.whatsappEnabled),
      workingHoursAr: asString(contactRaw.workingHoursAr, DEFAULT_SETTINGS.contact.workingHoursAr),
      workingHoursEn: asString(contactRaw.workingHoursEn, DEFAULT_SETTINGS.contact.workingHoursEn),
      noteAr: asString(contactRaw.noteAr, DEFAULT_SETTINGS.contact.noteAr),
      noteEn: asString(contactRaw.noteEn, DEFAULT_SETTINGS.contact.noteEn),
    },
    location: {
      centerNameAr: asString(locationRaw.centerNameAr, DEFAULT_SETTINGS.location.centerNameAr),
      centerNameEn: asString(locationRaw.centerNameEn, DEFAULT_SETTINGS.location.centerNameEn),
      departmentLocationAr: asString(locationRaw.departmentLocationAr, DEFAULT_SETTINGS.location.departmentLocationAr),
      departmentLocationEn: asString(locationRaw.departmentLocationEn, DEFAULT_SETTINGS.location.departmentLocationEn),
      roomUnitFloorAr: asString(locationRaw.roomUnitFloorAr, DEFAULT_SETTINGS.location.roomUnitFloorAr),
      roomUnitFloorEn: asString(locationRaw.roomUnitFloorEn, DEFAULT_SETTINGS.location.roomUnitFloorEn),
      addressAr: asString(locationRaw.addressAr, DEFAULT_SETTINGS.location.addressAr),
      addressEn: asString(locationRaw.addressEn, DEFAULT_SETTINGS.location.addressEn),
      arrivalInstructionsAr: asString(locationRaw.arrivalInstructionsAr, DEFAULT_SETTINGS.location.arrivalInstructionsAr),
      arrivalInstructionsEn: asString(locationRaw.arrivalInstructionsEn, DEFAULT_SETTINGS.location.arrivalInstructionsEn),
      googleMapsUrl: asString(locationRaw.googleMapsUrl, DEFAULT_SETTINGS.location.googleMapsUrl),
      parkingNoteAr: asString(locationRaw.parkingNoteAr, DEFAULT_SETTINGS.location.parkingNoteAr),
      parkingNoteEn: asString(locationRaw.parkingNoteEn, DEFAULT_SETTINGS.location.parkingNoteEn),
    },
  };
}

export async function readPatientQrSettings(): Promise<PatientQrSettings> {
  const rows = await getSettingsByCategory("patient_qr_self_service");
  const configRow = rows.find((row) => row.setting_key === "config");
  const rawValue = readRawValue(configRow?.setting_value);
  return normalizePatientQrSettings(rawValue);
}

export function getDefaultPatientQrSettings(): PatientQrSettings {
  return normalizePatientQrSettings(DEFAULT_SETTINGS);
}
