import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Save, Trash2, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized } from "@/lib/i18n";
import { fetchPatientQrSettings, savePatientQrSettings, type PatientQrSettings } from "@/lib/api-hooks";

interface PatientQrSettingsSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

const DEFAULT_SETTINGS: PatientQrSettings = {
  enabled: true,
  printQrOnAppointmentSlip: true,
  allowCancellation: true,
  allowAddToCalendar: true,
  showBookingTime: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: false,
  showLocationDirections: false,
  allowReportAccess: false,
  showReportPendingCard: true,
  reportAccessRequiresCompletedAppointment: true,
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
  pageTitleAr: "خدمة المريض عبر رمز QR",
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

export default function PatientQrSettingsSection({ onReAuthRequired }: PatientQrSettingsSectionProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["patient-qr-settings"],
    queryFn: fetchPatientQrSettings,
  });
  const [draft, setDraft] = useState<PatientQrSettings>(DEFAULT_SETTINGS);
  const [newChecklistItemAr, setNewChecklistItemAr] = useState("");
  const [newChecklistItemEn, setNewChecklistItemEn] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) setDraft(cloneSettings(data));
  }, [data]);

  const mutation = useMutation({
    mutationFn: (payload: PatientQrSettings) => savePatientQrSettings(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patient-qr-settings"] });
      setErrors({});
    },
    onError: (err: unknown) => {
      const status = err instanceof ApiError ? err.status : undefined;
      const message = err instanceof Error ? err.message : "";
      if (status === 401 || status === 403 || message.includes("re-authentication") || message.includes("403")) {
        onReAuthRequired(["settings", "patient_qr_self_service"]);
        return;
      }
      setErrors((current) => ({
        ...current,
        save: message || "تعذر حفظ الإعدادات.",
      }));
    },
  });

  const canSave = useMemo(() => {
    const nextErrors: Record<string, string> = {};
    if (!isValidPhone(draft.contact.primaryPhone)) nextErrors.contactPrimaryPhone = "رقم الهاتف غير صالح.";
    if (!isValidPhone(draft.contact.secondaryPhone)) nextErrors.contactSecondaryPhone = "رقم الهاتف غير صالح.";
    if (!isValidPhone(draft.contact.whatsapp)) nextErrors.contactWhatsapp = "رقم الواتساب غير صالح.";
    if (!isValidUrl(draft.location.googleMapsUrl)) nextErrors.googleMapsUrl = "رابط خرائط Google غير صالح.";
    if (draft.documentsChecklistAr.some((item) => !item.trim())) nextErrors.checklistAr = "جميع عناصر القائمة يجب أن تكون غير فارغة.";
    if (draft.documentsChecklistEn.some((item) => !item.trim())) nextErrors.checklistEn = "All checklist items must be non-empty.";
    return { ok: Object.keys(nextErrors).length === 0, nextErrors };
  }, [draft]);

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
          <ToggleRow label={chooseLocalized(language, "طباعة رمز QR على ورقة الموعد", "Print QR Code on Appointment Slip")} checked={draft.printQrOnAppointmentSlip} onChange={(checked) => setDraft((current) => ({ ...current, printQrOnAppointmentSlip: checked }))} />
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FieldCard title={chooseLocalized(language, "التقارير في صفحة QR", "Patient QR Report Access")}>
          <ToggleRow label={chooseLocalized(language, "تفعيل الوصول للتقرير من صفحة QR", "Enable report access from patient QR page")} checked={draft.allowReportAccess} onChange={(checked) => setDraft((current) => ({ ...current, allowReportAccess: checked }))} />
          <ToggleRow label={chooseLocalized(language, "اشتراط اكتمال الموعد قبل الوصول للتقرير", "Require completed appointment before report access")} checked={draft.reportAccessRequiresCompletedAppointment} onChange={(checked) => setDraft((current) => ({ ...current, reportAccessRequiresCompletedAppointment: checked }))} />
          <ToggleRow label={chooseLocalized(language, "إظهار بطاقة التقرير المعلق", "Show pending report card")} checked={draft.showReportPendingCard} onChange={(checked) => setDraft((current) => ({ ...current, showReportPendingCard: checked }))} />
          <ToggleRow label={chooseLocalized(language, "إظهار رسالة عندما لا يكون التقرير مطلوباً", "Show not-required message")} checked={draft.showReportNotRequiredMessage} onChange={(checked) => setDraft((current) => ({ ...current, showReportNotRequiredMessage: checked }))} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Check report button label" value={draft.qrReportCheckButtonLabel} onChange={(value) => setDraft((current) => ({ ...current, qrReportCheckButtonLabel: value }))} />
            <Input label="View report button label" value={draft.qrReportViewButtonLabel} onChange={(value) => setDraft((current) => ({ ...current, qrReportViewButtonLabel: value }))} />
          </div>
          <Textarea label="Checking message" value={draft.qrReportCheckingMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportCheckingMessage: value }))} />
          <Textarea label="Final report message" value={draft.qrReportFinalMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportFinalMessage: value }))} />
          <Textarea label="Draft/in-review report message" value={draft.qrReportDraftMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportDraftMessage: value }))} />
          <Textarea label="No-report message" value={draft.qrReportNoReportMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportNoReportMessage: value }))} />
          <Textarea label="Unavailable message" value={draft.qrReportUnavailableMessage} onChange={(value) => setDraft((current) => ({ ...current, qrReportUnavailableMessage: value }))} />
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
