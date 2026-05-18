import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Save, Trash2, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, type Language } from "@/lib/i18n";
import { fetchModalitiesSettings, fetchPatientQrSettings, savePatientQrSettings, type PatientQrSettings } from "@/lib/api-hooks";
import { fetchV2Modalities } from "@/v2/appointments/api";

interface PatientQrSettingsSectionProps {
  onReAuthRequired: (key: string[]) => void;
  reauthVersion?: number;
}

const DEFAULT_SETTINGS: PatientQrSettings = {
  enabled: true,
  risproPublicBaseUrl: "https://rispro.nccb.com.ly",
  printQrOnAppointmentSlip: true,
  qrSlipPaperMode: "blank",
  qrSlipPaperSize: "a4",
  allowCancellation: true,
  allowAddToCalendar: true,
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

function cloneSettings(settings: PatientQrSettings): PatientQrSettings {
  return {
    ...settings,
    reportAccessModalityIds: [...(settings.reportAccessModalityIds ?? [])],
    imageAccessModalityIds: [...(settings.imageAccessModalityIds ?? [])],
    documentsChecklistAr: [...settings.documentsChecklistAr],
    documentsChecklistEn: [...settings.documentsChecklistEn],
    contact: { ...settings.contact },
    location: { ...settings.location },
  };
}

function normalizePhone(value: string): string {
  return String(value || "").trim().replace(/[\s().-]/g, "");
}

function isValidPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  if (!normalized) return true;
  return /^\+?\d{7,15}$/.test(normalized);
}

function isValidUrl(value: string): boolean {
  const trimmed = String(value || "").trim();
  if (!trimmed) return true;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

export default function PatientQrSettingsSection({ onReAuthRequired, reauthVersion = 0 }: PatientQrSettingsSectionProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["patient-qr-settings"],
    queryFn: fetchPatientQrSettings,
  });
  const { data: modalitiesData } = useQuery({
    queryKey: ["modalities-settings", "active"],
    queryFn: () => fetchModalitiesSettings(false),
  });
  const { data: lookupModalities, isLoading: lookupModalitiesLoading } = useQuery({
    queryKey: ["v2-modalities", "patient-qr-settings"],
    queryFn: fetchV2Modalities,
  });
  const [draft, setDraft] = useState<PatientQrSettings>(DEFAULT_SETTINGS);
  const [newChecklistItemAr, setNewChecklistItemAr] = useState("");
  const [newChecklistItemEn, setNewChecklistItemEn] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingSaveAfterReAuth, setPendingSaveAfterReAuth] = useState<{
    payload: PatientQrSettings;
    requestedAtVersion: number;
  } | null>(null);

  useEffect(() => {
    if (data) setDraft(cloneSettings(data));
  }, [data]);

  const mutation = useMutation({
    mutationFn: (payload: PatientQrSettings) => savePatientQrSettings(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patient-qr-settings"] });
      setPendingSaveAfterReAuth(null);
      setErrors({});
    },
    onError: (err: unknown, payload) => {
      const status = err instanceof ApiError ? err.status : undefined;
      const message = err instanceof Error ? err.message : "";
      if (status === 401 || status === 403 || message.includes("re-authentication") || message.includes("403")) {
        setPendingSaveAfterReAuth({ payload, requestedAtVersion: reauthVersion });
        onReAuthRequired(["settings", "patient_qr_self_service"]);
        return;
      }
      setErrors((current) => ({
        ...current,
        save: message || "تعذر حفظ الإعدادات.",
      }));
    },
  });

  useEffect(() => {
    if (!pendingSaveAfterReAuth || reauthVersion <= pendingSaveAfterReAuth.requestedAtVersion || mutation.isPending) return;
    const { payload } = pendingSaveAfterReAuth;
    setPendingSaveAfterReAuth(null);
    mutation.mutate(payload);
  }, [reauthVersion, pendingSaveAfterReAuth, mutation]);

  const canSave = useMemo(() => {
    const nextErrors: Record<string, string> = {};
    if (!isValidUrl(draft.risproPublicBaseUrl)) nextErrors.risproPublicBaseUrl = "Public RISpro URL is invalid.";
    if (!isValidPhone(draft.contact.primaryPhone)) nextErrors.contactPrimaryPhone = "رقم الهاتف غير صالح.";
    if (!isValidPhone(draft.contact.secondaryPhone)) nextErrors.contactSecondaryPhone = "رقم الهاتف غير صالح.";
    if (!isValidPhone(draft.contact.whatsapp)) nextErrors.contactWhatsapp = "رقم الواتساب غير صالح.";
    if (!isValidUrl(draft.location.googleMapsUrl)) nextErrors.googleMapsUrl = "رابط خرائط Google غير صالح.";
    if (draft.documentsChecklistAr.some((item) => !item.trim())) nextErrors.checklistAr = "جميع عناصر القائمة يجب أن تكون غير فارغة.";
    if (draft.documentsChecklistEn.some((item) => !item.trim())) nextErrors.checklistEn = "All checklist items must be non-empty.";
    return { ok: Object.keys(nextErrors).length === 0, nextErrors };
  }, [draft]);

  const activeModalities = useMemo(() => {
    const rows = [
      ...((modalitiesData?.modalities ?? []) as Array<Record<string, unknown>>),
      ...((lookupModalities ?? []) as unknown as Array<Record<string, unknown>>),
    ];
    const byId = new Map<number, { id: number; nameAr: string; nameEn: string; code: string }>();
    for (const row of rows) {
      const id = Number(row.id ?? 0);
      if (!Number.isFinite(id) || id <= 0 || byId.has(id)) continue;
      byId.set(id, {
        id,
        nameAr: String(row.nameAr ?? row.name_ar ?? ""),
        nameEn: String(row.nameEn ?? row.name_en ?? ""),
        code: String(row.code ?? ""),
      });
    }
    return Array.from(byId.values());
  }, [lookupModalities, modalitiesData]);
  const modalityChecklistLoading = !modalitiesData && lookupModalitiesLoading;

  const updateChecklistItemAr = (index: number, value: string) => {
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistAr[index] = value;
      return next;
    });
  };

  const updateChecklistItemEn = (index: number, value: string) => {
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistEn[index] = value;
      return next;
    });
  };

  const moveChecklistItemAr = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const next = cloneSettings(current);
      const target = index + direction;
      if (target < 0 || target >= next.documentsChecklistAr.length) return current;
      const item = next.documentsChecklistAr[index];
      next.documentsChecklistAr[index] = next.documentsChecklistAr[target];
      next.documentsChecklistAr[target] = item;
      return next;
    });
  };

  const moveChecklistItemEn = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const next = cloneSettings(current);
      const target = index + direction;
      if (target < 0 || target >= next.documentsChecklistEn.length) return current;
      const item = next.documentsChecklistEn[index];
      next.documentsChecklistEn[index] = next.documentsChecklistEn[target];
      next.documentsChecklistEn[target] = item;
      return next;
    });
  };

  const removeChecklistItemAr = (index: number) => {
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistAr.splice(index, 1);
      return next;
    });
  };

  const removeChecklistItemEn = (index: number) => {
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistEn.splice(index, 1);
      return next;
    });
  };

  const addChecklistItemAr = () => {
    const value = newChecklistItemAr.trim();
    if (!value) return;
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistAr.push(value);
      return next;
    });
    setNewChecklistItemAr("");
  };

  const addChecklistItemEn = () => {
    const value = newChecklistItemEn.trim();
    if (!value) return;
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistEn.push(value);
      return next;
    });
    setNewChecklistItemEn("");
  };

  const handleSave = () => {
    setErrors(canSave.nextErrors);
    if (!canSave.ok) return;
    mutation.mutate({
      ...draft,
      risproPublicBaseUrl: draft.risproPublicBaseUrl.trim(),
      documentsChecklistAr: draft.documentsChecklistAr.map((item) => item.trim()).filter(Boolean),
      documentsChecklistEn: draft.documentsChecklistEn.map((item) => item.trim()).filter(Boolean),
      contact: {
        ...draft.contact,
        primaryPhone: draft.contact.primaryPhone.trim(),
        secondaryPhone: draft.contact.secondaryPhone.trim(),
        whatsapp: draft.contact.whatsapp.trim(),
        workingHoursAr: draft.contact.workingHoursAr.trim(),
        workingHoursEn: draft.contact.workingHoursEn.trim(),
        noteAr: draft.contact.noteAr.trim(),
        noteEn: draft.contact.noteEn.trim(),
      },
      location: {
        ...draft.location,
        centerNameAr: draft.location.centerNameAr.trim(),
        centerNameEn: draft.location.centerNameEn.trim(),
        departmentLocationAr: draft.location.departmentLocationAr.trim(),
        departmentLocationEn: draft.location.departmentLocationEn.trim(),
        roomUnitFloorAr: draft.location.roomUnitFloorAr.trim(),
        roomUnitFloorEn: draft.location.roomUnitFloorEn.trim(),
        addressAr: draft.location.addressAr.trim(),
        addressEn: draft.location.addressEn.trim(),
        arrivalInstructionsAr: draft.location.arrivalInstructionsAr.trim(),
        arrivalInstructionsEn: draft.location.arrivalInstructionsEn.trim(),
        googleMapsUrl: draft.location.googleMapsUrl.trim(),
        parkingNoteAr: draft.location.parkingNoteAr.trim(),
        parkingNoteEn: draft.location.parkingNoteEn.trim(),
      },
      reportAccessModalityIds: Array.from(new Set((draft.reportAccessModalityIds ?? []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))),
      imageAccessModalityIds: Array.from(new Set((draft.imageAccessModalityIds ?? []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))),
    });
  };

  if (isLoading) {
    return <p className="text-sm text-slate-500">{chooseLocalized(language, "جاري تحميل إعدادات صفحة QR...", "Loading QR page settings...")}</p>;
  }

  if (error) {
    const message = error instanceof Error ? error.message : "";
    const status = error instanceof ApiError ? error.status : undefined;
    if (status === 401 || status === 403 || message.includes("re-authentication") || message.includes("403")) {
      return (
        <ReAuthPrompt
          onReAuthRequired={() => onReAuthRequired(["settings", "patient_qr_self_service"])}
        />
      );
    }
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
        {chooseLocalized(language, "تعذر تحميل إعدادات صفحة QR.", "Failed to load QR page settings.")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <h4 className="text-base font-extrabold text-slate-900">{chooseLocalized(language, "إعدادات صفحة المريض ورمز QR", "Patient QR Page Settings")}</h4>
        <p className="mt-1 text-sm leading-7 text-slate-600">
          {chooseLocalized(language, "تحكم في ظهور الصفحة، قسم الإلغاء، التقويم، التعليمات، قائمة المستندات، ومعلومات التواصل والموقع.", "Control page visibility, cancellation section, calendar, instructions, documents checklist, and contact/location information.")}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FieldCard title={chooseLocalized(language, "التحكم العام", "General Controls")}>
          <ToggleRow label={chooseLocalized(language, "تفعيل صفحة QR للمرضى", "Enable QR Page for Patients")} checked={draft.enabled} onChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))} />
          <Input
            dir="ltr"
            label={chooseLocalized(language, "رابط RISpro العام", "Public RISpro Base URL")}
            value={draft.risproPublicBaseUrl}
            onChange={(value) => setDraft((current) => ({ ...current, risproPublicBaseUrl: value }))}
            error={errors.risproPublicBaseUrl}
          />
          <ToggleRow label={chooseLocalized(language, "طباعة رمز QR على ورقة الموعد", "Print QR Code on Appointment Slip")} checked={draft.printQrOnAppointmentSlip} onChange={(checked) => setDraft((current) => ({ ...current, printQrOnAppointmentSlip: checked }))} />
          <SelectField
            label={chooseLocalized(language, "نمط ورقة الموعد في صفحة QR", "QR appointment slip paper mode")}
            value={draft.qrSlipPaperMode}
            onChange={(value) => setDraft((current) => ({ ...current, qrSlipPaperMode: value as PatientQrSettings["qrSlipPaperMode"] }))}
            options={[
              { value: "blank", label: chooseLocalized(language, "ورق فارغ", "Blank paper") },
              { value: "preprinted", label: chooseLocalized(language, "ورق مطبوع مسبقًا", "Preprinted") },
            ]}
          />
          <SelectField
            label={chooseLocalized(language, "حجم ورقة الموعد في صفحة QR", "QR appointment slip paper size")}
            value={draft.qrSlipPaperSize}
            onChange={(value) => setDraft((current) => ({ ...current, qrSlipPaperSize: value as PatientQrSettings["qrSlipPaperSize"] }))}
            options={[
              { value: "a4", label: "A4" },
              { value: "a5", label: "A5" },
            ]}
          />
          <ToggleRow label={chooseLocalized(language, "السماح بإلغاء الموعد", "Allow Appointment Cancellation")} checked={draft.allowCancellation} onChange={(checked) => setDraft((current) => ({ ...current, allowCancellation: checked }))} />
          <ToggleRow label={chooseLocalized(language, "إضافة إلى التقويم", "Add to Calendar")} checked={draft.allowAddToCalendar} onChange={(checked) => setDraft((current) => ({ ...current, allowAddToCalendar: checked }))} />
          <ToggleRow label={chooseLocalized(language, "إظهار وقت الموعد في صفحة QR", "Show Appointment Time on QR Page")} checked={draft.showBookingTime} onChange={(checked) => setDraft((current) => ({ ...current, showBookingTime: checked }))} />
        </FieldCard>

        <FieldCard title={chooseLocalized(language, "محتوى الصفحة", "Page Content")}>
          <label className="block text-sm font-semibold text-slate-700">{chooseLocalized(language, "عنوان الصفحة", "Page Title")}</label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <input
              dir="ltr"
              value={draft.pageTitleEn}
              onChange={(e) => setDraft((current) => ({ ...current, pageTitleEn: e.target.value }))}
              placeholder={chooseLocalized(language, "عنوان الصفحة (عربي)", "Page title (English)")}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-ltr"
            />
            <input
              dir="rtl"
              value={draft.pageTitleAr}
              onChange={(e) => setDraft((current) => ({ ...current, pageTitleAr: e.target.value }))}
              placeholder={chooseLocalized(language, "عنوان الصفحة (عربي)", "Page title (English)")}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-rtl"
            />
          </div>

          <label className="mt-3 block text-sm font-semibold text-slate-700">{chooseLocalized(language, "مقدمة الصفحة", "Page Introduction")}</label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <textarea
              dir="ltr"
              value={draft.introTextEn}
              onChange={(e) => setDraft((current) => ({ ...current, introTextEn: e.target.value }))}
              rows={3}
              placeholder="Page intro (English)"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-ltr"
            />
            <textarea
              dir="rtl"
              value={draft.introTextAr}
              onChange={(e) => setDraft((current) => ({ ...current, introTextAr: e.target.value }))}
              rows={3}
              placeholder="مقدمة الصفحة (عربي)"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-rtl"
            />
          </div>

          <label className="mt-3 block text-sm font-semibold text-slate-700">{chooseLocalized(language, "نص التحضير العام", "General Preparation Text")}</label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <textarea
              dir="ltr"
              value={draft.genericPreparationTextEn}
              onChange={(e) => setDraft((current) => ({ ...current, genericPreparationTextEn: e.target.value }))}
              rows={3}
              placeholder={chooseLocalized(language, "نص التحضير العام (عربي)", "General preparation text (English)")}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-ltr"
            />
            <textarea
              dir="rtl"
              value={draft.genericPreparationTextAr}
              onChange={(e) => setDraft((current) => ({ ...current, genericPreparationTextAr: e.target.value }))}
              rows={3}
              placeholder={chooseLocalized(language, "نص التحضير العام (عربي)", "General preparation text (English)")}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-rtl"
            />
          </div>
        </FieldCard>

        <FieldCard title={chooseLocalized(language, "تنبيهات المتصفح للمرضى", "Patient Browser Notifications")}>
          <ToggleRow label="Enable Web Push notification card" checked={draft.webPushEnabled} onChange={(checked) => setDraft((current) => ({ ...current, webPushEnabled: checked }))} />
          <ToggleRow label="Default: 24-hour reminder" checked={draft.webPushDefaultReminder24h} onChange={(checked) => setDraft((current) => ({ ...current, webPushDefaultReminder24h: checked }))} />
          <ToggleRow label="Default: rescheduled" checked={draft.webPushDefaultRescheduled} onChange={(checked) => setDraft((current) => ({ ...current, webPushDefaultRescheduled: checked }))} />
          <ToggleRow label="Default: cancelled" checked={draft.webPushDefaultCancelled} onChange={(checked) => setDraft((current) => ({ ...current, webPushDefaultCancelled: checked }))} />
          <ToggleRow label="Default: changed" checked={draft.webPushDefaultChanged} onChange={(checked) => setDraft((current) => ({ ...current, webPushDefaultChanged: checked }))} />
          <ToggleRow label="Default: report ready" checked={draft.webPushDefaultReportReady} onChange={(checked) => setDraft((current) => ({ ...current, webPushDefaultReportReady: checked }))} />
          <ToggleRow label="Default: image ready" checked={draft.webPushDefaultImageReady} onChange={(checked) => setDraft((current) => ({ ...current, webPushDefaultImageReady: checked }))} />
          <Input label="Card title" value={draft.webPushCardTitleEn} onChange={(value) => setDraft((current) => ({ ...current, webPushCardTitleEn: value }))} />
          <Textarea label="Card body" value={draft.webPushCardBodyEn} onChange={(value) => setDraft((current) => ({ ...current, webPushCardBodyEn: value }))} />
          <Input label="Subscribe button" value={draft.webPushSubscribeButtonEn} onChange={(value) => setDraft((current) => ({ ...current, webPushSubscribeButtonEn: value }))} />
          <Input label="Unsubscribe button" value={draft.webPushUnsubscribeButtonEn} onChange={(value) => setDraft((current) => ({ ...current, webPushUnsubscribeButtonEn: value }))} />
          <Input label="Test button" value={draft.webPushTestButtonEn} onChange={(value) => setDraft((current) => ({ ...current, webPushTestButtonEn: value }))} />
          <Input label="iPhone help button (Arabic)" value={draft.webPushIosHelpButtonAr} onChange={(value) => setDraft((current) => ({ ...current, webPushIosHelpButtonAr: value }))} />
          <Input label="iPhone help button (English)" value={draft.webPushIosHelpButtonEn} onChange={(value) => setDraft((current) => ({ ...current, webPushIosHelpButtonEn: value }))} />
          <Input label="iPhone help title (Arabic)" value={draft.webPushIosHelpTitleAr} onChange={(value) => setDraft((current) => ({ ...current, webPushIosHelpTitleAr: value }))} />
          <Textarea label="iPhone help body (Arabic)" value={draft.webPushIosHelpBodyAr} onChange={(value) => setDraft((current) => ({ ...current, webPushIosHelpBodyAr: value }))} />
          <Input label="iPhone help title (English)" value={draft.webPushIosHelpTitleEn} onChange={(value) => setDraft((current) => ({ ...current, webPushIosHelpTitleEn: value }))} />
          <Textarea label="iPhone help body (English)" value={draft.webPushIosHelpBodyEn} onChange={(value) => setDraft((current) => ({ ...current, webPushIosHelpBodyEn: value }))} />
          <Input label="Reminder notification title (Arabic)" value={draft.webPushAppointmentReminder24hTitleAr} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentReminder24hTitleAr: value }))} />
          <Textarea label="Reminder notification body (Arabic)" value={draft.webPushAppointmentReminder24hBodyAr} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentReminder24hBodyAr: value }))} />
          <Input label="Reminder notification title (English)" value={draft.webPushAppointmentReminder24hTitle} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentReminder24hTitle: value }))} />
          <Textarea label="Reminder notification body (English)" value={draft.webPushAppointmentReminder24hBody} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentReminder24hBody: value }))} />
          <Input label="Rescheduled notification title (Arabic)" value={draft.webPushAppointmentRescheduledTitleAr} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentRescheduledTitleAr: value }))} />
          <Textarea label="Rescheduled notification body (Arabic)" value={draft.webPushAppointmentRescheduledBodyAr} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentRescheduledBodyAr: value }))} />
          <Input label="Rescheduled notification title (English)" value={draft.webPushAppointmentRescheduledTitle} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentRescheduledTitle: value }))} />
          <Textarea label="Rescheduled notification body (English)" value={draft.webPushAppointmentRescheduledBody} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentRescheduledBody: value }))} />
          <Input label="Cancelled notification title (Arabic)" value={draft.webPushAppointmentCancelledTitleAr} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentCancelledTitleAr: value }))} />
          <Textarea label="Cancelled notification body (Arabic)" value={draft.webPushAppointmentCancelledBodyAr} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentCancelledBodyAr: value }))} />
          <Input label="Cancelled notification title (English)" value={draft.webPushAppointmentCancelledTitle} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentCancelledTitle: value }))} />
          <Textarea label="Cancelled notification body (English)" value={draft.webPushAppointmentCancelledBody} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentCancelledBody: value }))} />
          <Input label="Changed notification title (Arabic)" value={draft.webPushAppointmentChangedTitleAr} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentChangedTitleAr: value }))} />
          <Textarea label="Changed notification body (Arabic)" value={draft.webPushAppointmentChangedBodyAr} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentChangedBodyAr: value }))} />
          <Input label="Changed notification title (English)" value={draft.webPushAppointmentChangedTitle} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentChangedTitle: value }))} />
          <Textarea label="Changed notification body (English)" value={draft.webPushAppointmentChangedBody} onChange={(value) => setDraft((current) => ({ ...current, webPushAppointmentChangedBody: value }))} />
          <Input label="Report-ready notification title (Arabic)" value={draft.webPushReportReadyTitleAr} onChange={(value) => setDraft((current) => ({ ...current, webPushReportReadyTitleAr: value }))} />
          <Textarea label="Report-ready notification body (Arabic)" value={draft.webPushReportReadyBodyAr} onChange={(value) => setDraft((current) => ({ ...current, webPushReportReadyBodyAr: value }))} />
          <Input label="Report-ready notification title (English)" value={draft.webPushReportReadyTitle} onChange={(value) => setDraft((current) => ({ ...current, webPushReportReadyTitle: value }))} />
          <Textarea label="Report-ready notification body (English)" value={draft.webPushReportReadyBody} onChange={(value) => setDraft((current) => ({ ...current, webPushReportReadyBody: value }))} />
          <Input label="Image-ready notification title (Arabic)" value={draft.webPushImageReadyTitleAr} onChange={(value) => setDraft((current) => ({ ...current, webPushImageReadyTitleAr: value }))} />
          <Textarea label="Image-ready notification body (Arabic)" value={draft.webPushImageReadyBodyAr} onChange={(value) => setDraft((current) => ({ ...current, webPushImageReadyBodyAr: value }))} />
          <Input label="Image-ready notification title (English)" value={draft.webPushImageReadyTitle} onChange={(value) => setDraft((current) => ({ ...current, webPushImageReadyTitle: value }))} />
          <Textarea label="Image-ready notification body (English)" value={draft.webPushImageReadyBody} onChange={(value) => setDraft((current) => ({ ...current, webPushImageReadyBody: value }))} />
          <Input label="Test notification title (Arabic)" value={draft.webPushTestTitleAr} onChange={(value) => setDraft((current) => ({ ...current, webPushTestTitleAr: value }))} />
          <Textarea label="Test notification body (Arabic)" value={draft.webPushTestBodyAr} onChange={(value) => setDraft((current) => ({ ...current, webPushTestBodyAr: value }))} />
          <Input label="Test notification title (English)" value={draft.webPushTestTitle} onChange={(value) => setDraft((current) => ({ ...current, webPushTestTitle: value }))} />
          <Textarea label="Test notification body (English)" value={draft.webPushTestBody} onChange={(value) => setDraft((current) => ({ ...current, webPushTestBody: value }))} />
        </FieldCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FieldCard title={chooseLocalized(language, "التقارير في صفحة QR", "Patient QR Report Access")}>
          <ToggleRow label={chooseLocalized(language, "تفعيل الوصول للتقرير من صفحة QR", "Enable report access from patient QR page")} checked={draft.allowReportAccess} onChange={(checked) => setDraft((current) => ({ ...current, allowReportAccess: checked }))} />
          <SelectField
            label={chooseLocalized(language, "نطاق الأجهزة للتقارير", "Report modality scope")}
            value={draft.reportAccessModalityMode}
            onChange={(value) => setDraft((current) => ({ ...current, reportAccessModalityMode: value as PatientQrSettings["reportAccessModalityMode"] }))}
            options={[
              { value: "all", label: chooseLocalized(language, "كل الأجهزة", "All modalities") },
              { value: "include", label: chooseLocalized(language, "الأجهزة المحددة فقط", "Only selected modalities") },
              { value: "exclude", label: chooseLocalized(language, "استثناء الأجهزة المحددة", "All except selected modalities") },
            ]}
          />
          {draft.reportAccessModalityMode !== "all" ? (
            <ModalityChecklist
              modalities={activeModalities}
              selected={draft.reportAccessModalityIds}
              language={language}
              loading={modalityChecklistLoading}
              onToggle={(id, checked) =>
                setDraft((current) => ({
                  ...current,
                  reportAccessModalityIds: checked
                    ? Array.from(new Set([...current.reportAccessModalityIds, id]))
                    : current.reportAccessModalityIds.filter((item) => item !== id),
                }))
              }
            />
          ) : null}
          <ToggleRow label="Enable image access from patient QR page" checked={draft.allowImageAccess} onChange={(checked) => setDraft((current) => ({ ...current, allowImageAccess: checked }))} />
          <SelectField
            label={chooseLocalized(language, "نطاق الأجهزة للصور", "Image modality scope")}
            value={draft.imageAccessModalityMode}
            onChange={(value) => setDraft((current) => ({ ...current, imageAccessModalityMode: value as PatientQrSettings["imageAccessModalityMode"] }))}
            options={[
              { value: "all", label: chooseLocalized(language, "كل الأجهزة", "All modalities") },
              { value: "include", label: chooseLocalized(language, "الأجهزة المحددة فقط", "Only selected modalities") },
              { value: "exclude", label: chooseLocalized(language, "استثناء الأجهزة المحددة", "All except selected modalities") },
            ]}
          />
          {draft.imageAccessModalityMode !== "all" ? (
            <ModalityChecklist
              modalities={activeModalities}
              selected={draft.imageAccessModalityIds}
              language={language}
              loading={modalityChecklistLoading}
              onToggle={(id, checked) =>
                setDraft((current) => ({
                  ...current,
                  imageAccessModalityIds: checked
                    ? Array.from(new Set([...current.imageAccessModalityIds, id]))
                    : current.imageAccessModalityIds.filter((item) => item !== id),
                }))
              }
            />
          ) : null}
          <ToggleRow label={chooseLocalized(language, "اشتراط اكتمال الموعد قبل الوصول للتقرير", "Require completed appointment before report access")} checked={draft.reportAccessRequiresCompletedAppointment} onChange={(checked) => setDraft((current) => ({ ...current, reportAccessRequiresCompletedAppointment: checked }))} />
          <ToggleRow label="Require completed appointment before image access" checked={draft.imageAccessRequiresCompletedAppointment} onChange={(checked) => setDraft((current) => ({ ...current, imageAccessRequiresCompletedAppointment: checked }))} />
          <ToggleRow label="Require Report required flag before image access" checked={draft.imageAccessRequiresReportRequiredFlag} onChange={(checked) => setDraft((current) => ({ ...current, imageAccessRequiresReportRequiredFlag: checked }))} />
          <ToggleRow label={chooseLocalized(language, "إظهار بطاقة التقرير المعلق", "Show pending report card")} checked={draft.showReportPendingCard} onChange={(checked) => setDraft((current) => ({ ...current, showReportPendingCard: checked }))} />
          <ToggleRow label={chooseLocalized(language, "إظهار رسالة عندما لا يكون التقرير مطلوباً", "Show not-required message")} checked={draft.showReportNotRequiredMessage} onChange={(checked) => setDraft((current) => ({ ...current, showReportNotRequiredMessage: checked }))} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Check report button label" value={draft.qrReportCheckButtonLabel} onChange={(value) => setDraft((current) => ({ ...current, qrReportCheckButtonLabel: value }))} />
            <Input label="View report button label" value={draft.qrReportViewButtonLabel} onChange={(value) => setDraft((current) => ({ ...current, qrReportViewButtonLabel: value }))} />
          </div>
          <Input label="View images button label" value={draft.qrImageViewButtonLabel} onChange={(value) => setDraft((current) => ({ ...current, qrImageViewButtonLabel: value }))} />
          <Textarea label="Checking message" value={draft.qrReportCheckingMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportCheckingMessage: value }))} />
          <Textarea label="Final report message" value={draft.qrReportFinalMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportFinalMessage: value }))} />
          <Textarea label="Draft/in-review report message" value={draft.qrReportDraftMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportDraftMessage: value }))} />
          <Textarea label="No-report message" value={draft.qrReportNoReportMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportNoReportMessage: value }))} />
          <Textarea label="Unavailable message" value={draft.qrReportUnavailableMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportUnavailableMessage: value }))} />
          <Textarea label="Report study-not-found message" value={draft.qrReportStudyNotFoundMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportStudyNotFoundMessage: value }))} />
          <Textarea label="Image unavailable message" value={draft.qrImageUnavailableMessage} onChange={(value) => setDraft((current) => ({ ...current, qrImageUnavailableMessage: value }))} />
          <Textarea label="Image study-not-found message" value={draft.qrImageStudyNotFoundMessage} onChange={(value) => setDraft((current) => ({ ...current, qrImageStudyNotFoundMessage: value }))} />
          <Textarea label="Not-required message" value={draft.qrReportNotRequiredMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportNotRequiredMessage: value }))} />
          <Textarea label="Not-completed message" value={draft.qrReportNotCompletedMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportNotCompletedMessage: value }))} />
        </FieldCard>

        <FieldCard title={chooseLocalized(language, "افتراضيات طلب التقرير", "Appointment Report Defaults")}>
          <ToggleRow label="Default Report required for oncology patients" checked={draft.defaultReportRequiredForOncology} onChange={(checked) => setDraft((current) => ({ ...current, defaultReportRequiredForOncology: checked }))} />
          <ToggleRow label="Default Report required for non-oncology patients" checked={draft.defaultReportRequiredForNonOncology} onChange={(checked) => setDraft((current) => ({ ...current, defaultReportRequiredForNonOncology: checked }))} />
        </FieldCard>
      </div>

      <FieldCard title={chooseLocalized(language, "تعليمات التحضير", "Preparation Instructions")}>
        <ToggleRow label={chooseLocalized(language, "إظهار تعليمات التحضير", "Show Preparation Instructions")} checked={draft.showPreparationInstructions} onChange={(checked) => setDraft((current) => ({ ...current, showPreparationInstructions: checked }))} />
        <p className="mt-2 text-sm leading-7 text-slate-600">
          {chooseLocalized(language, "تظهر تعليمات الجهاز وتعليمات الفحص كلٌ على حدة عندما تكون متاحة، ويستخدم هذا النص العام كبديل عند الحاجة.", "Device instructions and exam instructions appear separately when available, and this general text is used as a fallback when needed.")}
        </p>
      </FieldCard>

      <FieldCard title={chooseLocalized(language, "قائمة المستندات المطلوبة", "Required Documents")}>
        <ToggleRow label={chooseLocalized(language, "إظهار قائمة المستندات", "Show Documents Checklist")} checked={draft.showDocumentsChecklist} onChange={(checked) => setDraft((current) => ({ ...current, showDocumentsChecklist: checked }))} />
        <p className="mt-2 text-sm font-semibold text-slate-700">{chooseLocalized(language, "العربية", "Arabic")}</p>
        <div className="mt-1 space-y-2">
          {draft.documentsChecklistAr.map((item, index) => (
            <div key={`ar-${index}-${item}`} className="flex items-center gap-2">
              <input
                dir="rtl"
                value={item}
                onChange={(e) => updateChecklistItemAr(index, e.target.value)}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-rtl"
              />
              <button
                type="button"
                onClick={() => moveChecklistItemAr(index, -1)}
                aria-label="تحريك العنصر إلى الأعلى"
                className="rounded-xl border border-slate-300 bg-white p-2 text-slate-700"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => moveChecklistItemAr(index, 1)}
                aria-label="تحريك العنصر إلى الأسفل"
                className="rounded-xl border border-slate-300 bg-white p-2 text-slate-700"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => removeChecklistItemAr(index)}
                aria-label="حذف العنصر"
                className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              dir="rtl"
              value={newChecklistItemAr}
              onChange={(e) => setNewChecklistItemAr(e.target.value)}
              placeholder="إضافة عنصر جديد..."
              className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-rtl"
            />
            <button type="button" onClick={addChecklistItemAr} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">
              <Plus className="inline h-4 w-4" /> إضافة
            </button>
          </div>
          {errors.checklistAr ? <p className="text-sm text-rose-700">{errors.checklistAr}</p> : null}
        </div>

        <p className="mt-4 text-sm font-semibold text-slate-700">{chooseLocalized(language, "English", "English")}</p>
        <div className="mt-1 space-y-2">
          {draft.documentsChecklistEn.map((item, index) => (
            <div key={`en-${index}-${item}`} className="flex items-center gap-2">
              <input
                dir="ltr"
                value={item}
                onChange={(e) => updateChecklistItemEn(index, e.target.value)}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-ltr"
              />
              <button
                type="button"
                onClick={() => moveChecklistItemEn(index, -1)}
                aria-label="Move item up"
                className="rounded-xl border border-slate-300 bg-white p-2 text-slate-700"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => moveChecklistItemEn(index, 1)}
                aria-label="Move item down"
                className="rounded-xl border border-slate-300 bg-white p-2 text-slate-700"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => removeChecklistItemEn(index)}
                aria-label="Delete item"
                className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              dir="ltr"
              value={newChecklistItemEn}
              onChange={(e) => setNewChecklistItemEn(e.target.value)}
              placeholder="Add new item..."
              className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-ltr"
            />
            <button type="button" onClick={addChecklistItemEn} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">
              <Plus className="inline h-4 w-4" /> Add
            </button>
          </div>
          {errors.checklistEn ? <p className="text-sm text-rose-700">{errors.checklistEn}</p> : null}
        </div>
      </FieldCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <FieldCard title={chooseLocalized(language, "التواصل مع القسم", "Contact Department")}>
          <ToggleRow label={chooseLocalized(language, "إظهار بطاقة التواصل", "Show Contact Card")} checked={draft.showDepartmentContact} onChange={(checked) => setDraft((current) => ({ ...current, showDepartmentContact: checked }))} />
          <Input label={chooseLocalized(language, "رقم الهاتف الرئيسي", "Primary Phone")} value={draft.contact.primaryPhone} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, primaryPhone: value } }))} error={errors.contactPrimaryPhone} />
          <Input label={chooseLocalized(language, "رقم الهاتف الثاني", "Secondary Phone")} value={draft.contact.secondaryPhone} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, secondaryPhone: value } }))} error={errors.contactSecondaryPhone} />
          <ToggleRow label={chooseLocalized(language, "تفعيل الواتساب", "Enable WhatsApp")} checked={draft.contact.whatsappEnabled} onChange={(checked) => setDraft((current) => ({ ...current, contact: { ...current.contact, whatsappEnabled: checked } }))} />
          <Input label={chooseLocalized(language, "رقم الواتساب", "WhatsApp Number")} value={draft.contact.whatsapp} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, whatsapp: value } }))} error={errors.contactWhatsapp} />
          <div className="grid grid-cols-2 gap-2">
            <Input dir="ltr" label={chooseLocalized(language, "ساعات العمل (En)", "Working Hours (En)")} value={draft.contact.workingHoursEn} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, workingHoursEn: value } }))} />
            <Input dir="rtl" label={chooseLocalized(language, "ساعات العمل", "Working Hours (Ar)")} value={draft.contact.workingHoursAr} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, workingHoursAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "ملاحظة (En)", "Note (En)")} value={draft.contact.noteEn} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, noteEn: value } }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "ملاحظة قصيرة", "Note (Ar)")} value={draft.contact.noteAr} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, noteAr: value } }))} />
          </div>
        </FieldCard>

        <FieldCard title={chooseLocalized(language, "قوالب رسائل واتساب", "WhatsApp Message Templates")}>
          <p className="text-sm leading-6 text-slate-600">
            {chooseLocalized(language, "يمكنك استخدام {link} لرابط صفحة الموعد و {date} لتاريخ الموعد.", "Use {link} for the patient QR page link and {date} for the appointment date.")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "رابط صفحة الموعد (En)", "QR link message (En)")} value={draft.whatsappQrLinkMessageEn} onChange={(value) => setDraft((current) => ({ ...current, whatsappQrLinkMessageEn: value }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "رابط صفحة الموعد", "QR link message (Ar)")} value={draft.whatsappQrLinkMessageAr} onChange={(value) => setDraft((current) => ({ ...current, whatsappQrLinkMessageAr: value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "تذكير الموعد (En)", "Reminder message (En)")} value={draft.whatsappReminderMessageEn} onChange={(value) => setDraft((current) => ({ ...current, whatsappReminderMessageEn: value }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "تذكير الموعد", "Reminder message (Ar)")} value={draft.whatsappReminderMessageAr} onChange={(value) => setDraft((current) => ({ ...current, whatsappReminderMessageAr: value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "تغيير الموعد (En)", "Rescheduled message (En)")} value={draft.whatsappRescheduledMessageEn} onChange={(value) => setDraft((current) => ({ ...current, whatsappRescheduledMessageEn: value }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "تغيير الموعد", "Rescheduled message (Ar)")} value={draft.whatsappRescheduledMessageAr} onChange={(value) => setDraft((current) => ({ ...current, whatsappRescheduledMessageAr: value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "تحديث تفاصيل الموعد (En)", "Changed details message (En)")} value={draft.whatsappChangedMessageEn} onChange={(value) => setDraft((current) => ({ ...current, whatsappChangedMessageEn: value }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "تحديث تفاصيل الموعد", "Changed details message (Ar)")} value={draft.whatsappChangedMessageAr} onChange={(value) => setDraft((current) => ({ ...current, whatsappChangedMessageAr: value }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "إلغاء الموعد (En)", "Cancellation message (En)")} value={draft.whatsappCancelledMessageEn} onChange={(value) => setDraft((current) => ({ ...current, whatsappCancelledMessageEn: value }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "إلغاء الموعد", "Cancellation message (Ar)")} value={draft.whatsappCancelledMessageAr} onChange={(value) => setDraft((current) => ({ ...current, whatsappCancelledMessageAr: value }))} />
          </div>
        </FieldCard>

        <FieldCard title={chooseLocalized(language, "الموقع والدخول", "Location & Access")}>
          <ToggleRow label={chooseLocalized(language, "إظهار بطاقة الموقع", "Show Location Card")} checked={draft.showLocationDirections} onChange={(checked) => setDraft((current) => ({ ...current, showLocationDirections: checked }))} />
          <div className="grid grid-cols-2 gap-2">
            <Input dir="ltr" label={chooseLocalized(language, "اسم المركز (En)", "Center Name (En)")} value={draft.location.centerNameEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, centerNameEn: value } }))} />
            <Input dir="rtl" label={chooseLocalized(language, "اسم المركز", "Center Name (Ar)")} value={draft.location.centerNameAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, centerNameAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "اسم القسم / الموقع (En)", "Department/Location (En)")} value={draft.location.departmentLocationEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, departmentLocationEn: value } }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "اسم القسم / الموقع", "Department/Location (Ar)")} value={draft.location.departmentLocationAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, departmentLocationAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input dir="ltr" label={chooseLocalized(language, "الطابق / الوحدة / الغرفة (En)", "Floor/Unit/Room (En)")} value={draft.location.roomUnitFloorEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, roomUnitFloorEn: value } }))} />
            <Input dir="rtl" label={chooseLocalized(language, "الطابق / الوحدة / الغرفة", "Floor/Unit/Room (Ar)")} value={draft.location.roomUnitFloorAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, roomUnitFloorAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "العنوان (En)", "Address (En)")} value={draft.location.addressEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, addressEn: value } }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "العنوان", "Address (Ar)")} value={draft.location.addressAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, addressAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "إرشادات الوصول (En)", "Arrival Instructions (En)")} value={draft.location.arrivalInstructionsEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, arrivalInstructionsEn: value } }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "إرشادات الوصول", "Arrival Instructions (Ar)")} value={draft.location.arrivalInstructionsAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, arrivalInstructionsAr: value } }))} />
          </div>
          <Input label={chooseLocalized(language, "رابط خرائط Google", "Google Maps Link")} value={draft.location.googleMapsUrl} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, googleMapsUrl: value } }))} error={errors.googleMapsUrl} />
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label={chooseLocalized(language, "ملاحظة إضافية (En)", "Additional Note (En)")} value={draft.location.parkingNoteEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, parkingNoteEn: value } }))} />
            <Textarea dir="rtl" label={chooseLocalized(language, "ملاحظة إضافية", "Additional Note (Ar)")} value={draft.location.parkingNoteAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, parkingNoteAr: value } }))} />
          </div>
        </FieldCard>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={mutation.isPending}
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-teal-600 px-4 py-3 text-sm font-extrabold text-white disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {chooseLocalized(language, "حفظ", "Save")}
        </button>
      </div>
      {errors.save ? <p className="text-sm text-rose-700">{errors.save}</p> : null}
    </div>
  );
}

function FieldCard(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className="text-base font-extrabold text-slate-900">{props.title}</h4>
      <div className="mt-4 space-y-3">{props.children}</div>
    </div>
  );
}

function ToggleRow(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
      <span className="font-medium text-slate-700">{props.label}</span>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} className="h-5 w-5 rounded border-slate-300 text-teal-600" />
    </label>
  );
}

function Input(props: { label: string; value: string; onChange: (value: string) => void; error?: string; dir?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {props.label}
      </label>
      <input
        id={id}
        dir={props.dir}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      {props.error ? <p className="mt-1 text-sm text-rose-700">{props.error}</p> : null}
    </div>
  );
}

function SelectField(props: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModalityChecklist(props: {
  modalities: Array<{ id: number; nameAr: string; nameEn: string; code: string }>;
  selected: number[];
  language: Language;
  loading?: boolean;
  onToggle: (id: number, checked: boolean) => void;
}) {
  if (props.loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
        {chooseLocalized(props.language, "جاري تحميل الأجهزة...", "Loading modalities...")}
      </div>
    );
  }

  if (props.modalities.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        {chooseLocalized(props.language, "لا توجد أجهزة فعالة متاحة للاختيار.", "No active modalities are available to select.")}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      {props.modalities.map((modality) => {
        const checked = props.selected.includes(modality.id);
        const label =
          props.language === "en"
            ? modality.nameEn || modality.nameAr || modality.code || `#${modality.id}`
            : modality.nameAr || modality.nameEn || modality.code || `#${modality.id}`;
        return (
          <label key={modality.id} className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => props.onToggle(modality.id, event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600"
            />
            <span>{label}</span>
          </label>
        );
      })}
    </div>
  );
}

function Textarea(props: { label: string; value: string; onChange: (value: string) => void; dir?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {props.label}
      </label>
      <textarea
        id={id}
        dir={props.dir}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  const { language } = useLanguage();
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h4 className="text-base font-extrabold text-amber-900">{chooseLocalized(language, "إعادة التحقق مطلوبة", "Re-authentication Required")}</h4>
      <p className="mt-1 text-sm leading-7 text-amber-800">
        {chooseLocalized(language, "يلزم تأكيد صلاحية المشرف قبل تعديل إعدادات صفحة QR.", "Supervisor re-authentication is required before modifying QR page settings.")}
      </p>
      <button
        type="button"
        onClick={onReAuthRequired}
        className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
      >
        {chooseLocalized(language, "إعادة التحقق", "Re-authenticate")}
      </button>
    </div>
  );
}
