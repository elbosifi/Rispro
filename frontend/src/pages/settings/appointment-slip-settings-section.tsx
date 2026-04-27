import { useEffect, useId, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { chooseLocalized } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import {
  DEFAULT_APPOINTMENT_SLIP_SETTINGS,
  fetchAppointmentSlipSettings,
  fetchPatientQrSettings,
  saveAppointmentSlipSettings,
  type AppointmentSlipSettings,
  type PatientQrSettings,
} from "@/lib/api-hooks";

interface AppointmentSlipSettingsSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

const DEFAULT_SETTINGS: AppointmentSlipSettings = {
  ...DEFAULT_APPOINTMENT_SLIP_SETTINGS,
};

function cloneSettings(settings: AppointmentSlipSettings): AppointmentSlipSettings {
  return { ...settings };
}

function isFiniteNumber(value: string): boolean {
  if (!String(value).trim()) return false;
  return Number.isFinite(Number(value));
}

function normalizeForSave(settings: AppointmentSlipSettings): AppointmentSlipSettings {
  return {
    ...settings,
    safeTopMm: Number(settings.safeTopMm),
    safeBottomMm: Number(settings.safeBottomMm),
    safeLeftMm: Number(settings.safeLeftMm),
    safeRightMm: Number(settings.safeRightMm),
    contentPaddingMm: Number(settings.contentPaddingMm),
    fontScale: Number(settings.fontScale),
    qrSizeMm: Number(settings.qrSizeMm),
    barcodeHeightMm: Number(settings.barcodeHeightMm),
    barcodeWidthMm: Number(settings.barcodeWidthMm),
    maxInstructionLinesOnSlip: Number(settings.maxInstructionLinesOnSlip),
    hospitalNameAr: settings.hospitalNameAr.trim(),
    hospitalNameEn: settings.hospitalNameEn.trim(),
    departmentNameAr: settings.departmentNameAr.trim(),
    departmentNameEn: settings.departmentNameEn.trim(),
    slipTitleAr: settings.slipTitleAr.trim(),
    slipTitleEn: settings.slipTitleEn.trim(),
    patientDetailsHeadingAr: settings.patientDetailsHeadingAr.trim(),
    patientDetailsHeadingEn: settings.patientDetailsHeadingEn.trim(),
    appointmentDetailsHeadingAr: settings.appointmentDetailsHeadingAr.trim(),
    appointmentDetailsHeadingEn: settings.appointmentDetailsHeadingEn.trim(),
    instructionsHeadingAr: settings.instructionsHeadingAr.trim(),
    instructionsHeadingEn: settings.instructionsHeadingEn.trim(),
    modalityInstructionsHeadingAr: settings.modalityInstructionsHeadingAr.trim(),
    modalityInstructionsHeadingEn: settings.modalityInstructionsHeadingEn.trim(),
    examInstructionsHeadingAr: settings.examInstructionsHeadingAr.trim(),
    examInstructionsHeadingEn: settings.examInstructionsHeadingEn.trim(),
    locationHeadingAr: settings.locationHeadingAr.trim(),
    locationHeadingEn: settings.locationHeadingEn.trim(),
    qrCaptionAr: settings.qrCaptionAr.trim(),
    qrCaptionEn: settings.qrCaptionEn.trim(),
    qrHelperTextAr: settings.qrHelperTextAr.trim(),
    qrHelperTextEn: settings.qrHelperTextEn.trim(),
    barcodeCaptionAr: settings.barcodeCaptionAr.trim(),
    barcodeCaptionEn: settings.barcodeCaptionEn.trim(),
    fallbackInstructionTextAr: settings.fallbackInstructionTextAr.trim(),
    fallbackInstructionTextEn: settings.fallbackInstructionTextEn.trim(),
    locationTextAr: settings.locationTextAr.trim(),
    locationTextEn: settings.locationTextEn.trim(),
  };
}

export default function AppointmentSlipSettingsSection({ onReAuthRequired }: AppointmentSlipSettingsSectionProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["appointment-slip-settings"],
    queryFn: fetchAppointmentSlipSettings,
  });
  const { data: patientQrSettings } = useQuery({
    queryKey: ["patient-qr-settings"],
    queryFn: fetchPatientQrSettings,
  });
  const [draft, setDraft] = useState<AppointmentSlipSettings>(DEFAULT_SETTINGS);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) setDraft(cloneSettings(data));
  }, [data]);

  const validation = useMemo(() => {
    const nextErrors: Record<string, string> = {};
    const numericFields: Array<[keyof AppointmentSlipSettings, string]> = [
      ["safeTopMm", "Safe top"],
      ["safeBottomMm", "Safe bottom"],
      ["safeLeftMm", "Safe left"],
      ["safeRightMm", "Safe right"],
      ["contentPaddingMm", "Content padding"],
      ["fontScale", "Font scale"],
      ["qrSizeMm", "QR size"],
      ["barcodeHeightMm", "Barcode height"],
      ["barcodeWidthMm", "Barcode width"],
      ["maxInstructionLinesOnSlip", "Instruction lines"],
    ];
    for (const [key, label] of numericFields) {
      if (!isFiniteNumber(String(draft[key]))) {
        nextErrors[String(key)] = `${label} must be a valid number.`;
      }
    }
    if (draft.hospitalNameAr.includes("المركز الوطني لعلاج الأورام بنغازي")) {
      nextErrors.hospitalNameAr = "Use المركز الوطني للأورام بنغازي.";
    }
    return { ok: Object.keys(nextErrors).length === 0, nextErrors };
  }, [draft]);

  const mutation = useMutation({
    mutationFn: (payload: AppointmentSlipSettings) => saveAppointmentSlipSettings(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["appointment-slip-settings"] });
      setErrors({});
    },
    onError: (err: unknown) => {
      const status = err instanceof ApiError ? err.status : undefined;
      const message = err instanceof Error ? err.message : "";
      if (status === 401 || status === 403 || message.includes("re-authentication") || message.includes("403")) {
        onReAuthRequired(["settings", "appointment_slip"]);
        return;
      }
      setErrors((current) => ({
        ...current,
        save: message || "تعذر حفظ إعدادات وصل الموعد.",
      }));
    },
  });

  const qrWarning = getQrDependencyWarning(patientQrSettings);

  const handleSave = () => {
    setErrors(validation.nextErrors);
    if (!validation.ok) return;
    mutation.mutate(normalizeForSave(draft));
  };

  if (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("re-authentication") || msg.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "appointment_slip"])} />;
    }
    return <p className="text-sm text-rose-700">{msg || "Failed to load appointment slip settings."}</p>;
  }

  if (isLoading) {
    return <p className="text-sm text-slate-600">{chooseLocalized(language, "جارٍ تحميل إعدادات وصل الموعد...", "Loading appointment slip settings...")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-base font-extrabold text-slate-900">{chooseLocalized(language, "إعدادات طباعة وصل الموعد", "Appointment Slip Print Settings")}</h3>
        <p className="mt-1 text-sm leading-7 text-slate-600">
          {chooseLocalized(
            language,
            "هذه الإعدادات تتحكم في الورق المطبوع فقط: اللغة، الحقول، هوامش الأمان، ونصوص QR والباركود.",
            "These settings only control the printed paper: language, visible fields, safe-area geometry, and QR/barcode captions."
          )}
        </p>
      </div>

      {qrWarning ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="text-sm leading-7">{qrWarning}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <FieldCard title={chooseLocalized(language, "الورق والتخطيط", "Paper & Layout")}>
          <SelectField
            label={chooseLocalized(language, "نمط الورق", "Paper mode")}
            value={draft.paperMode}
            onChange={(value) => setDraft((current) => ({ ...current, paperMode: value as AppointmentSlipSettings["paperMode"] }))}
            options={[
              { value: "preprinted", label: chooseLocalized(language, "ورق مطبوع مسبقًا", "Preprinted") },
              { value: "blank", label: chooseLocalized(language, "ورق فارغ", "Blank paper") },
            ]}
          />
          <SelectField
            label={chooseLocalized(language, "نمط اللغة", "Language mode")}
            value={draft.languageMode}
            onChange={(value) => setDraft((current) => ({ ...current, languageMode: value as AppointmentSlipSettings["languageMode"] }))}
            options={[
              { value: "bilingual", label: chooseLocalized(language, "ثنائي اللغة", "Bilingual") },
              { value: "ar", label: chooseLocalized(language, "العربية", "Arabic") },
              { value: "en", label: chooseLocalized(language, "الإنجليزية", "English") },
            ]}
          />
          <ToggleRow
            label={chooseLocalized(language, "Ø¬Ø¹Ù„ Ù†Øµ Ø§Ù„ÙˆØµÙ„ Ø¹Ø±ÙŠØ¶Ù‹Ø§", "Bold appointment slip text")}
            checked={draft.boldAppointmentSlipText}
            onChange={(checked) => setDraft((current) => ({ ...current, boldAppointmentSlipText: checked }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Safe top (mm)" value={draft.safeTopMm} onChange={(value) => setDraft((current) => ({ ...current, safeTopMm: value }))} error={errors.safeTopMm} />
            <NumberField label="Safe bottom (mm)" value={draft.safeBottomMm} onChange={(value) => setDraft((current) => ({ ...current, safeBottomMm: value }))} error={errors.safeBottomMm} />
            <NumberField label="Safe left (mm)" value={draft.safeLeftMm} onChange={(value) => setDraft((current) => ({ ...current, safeLeftMm: value }))} error={errors.safeLeftMm} />
            <NumberField label="Safe right (mm)" value={draft.safeRightMm} onChange={(value) => setDraft((current) => ({ ...current, safeRightMm: value }))} error={errors.safeRightMm} />
            <NumberField label="Content padding (mm)" value={draft.contentPaddingMm} onChange={(value) => setDraft((current) => ({ ...current, contentPaddingMm: value }))} error={errors.contentPaddingMm} />
            <NumberField label="Font scale" value={draft.fontScale} step="0.05" onChange={(value) => setDraft((current) => ({ ...current, fontScale: value }))} error={errors.fontScale} />
            <NumberField label="QR size (mm)" value={draft.qrSizeMm} onChange={(value) => setDraft((current) => ({ ...current, qrSizeMm: value }))} error={errors.qrSizeMm} />
            <NumberField label="Barcode height (mm)" value={draft.barcodeHeightMm} onChange={(value) => setDraft((current) => ({ ...current, barcodeHeightMm: value }))} error={errors.barcodeHeightMm} />
            <NumberField label="Barcode width (mm)" value={draft.barcodeWidthMm} onChange={(value) => setDraft((current) => ({ ...current, barcodeWidthMm: value }))} error={errors.barcodeWidthMm} />
          </div>
        </FieldCard>

        <FieldCard title={chooseLocalized(language, "هوية المستشفى", "Hospital Identity")}>
          <InputField label="Hospital name (Ar)" value={draft.hospitalNameAr} onChange={(value) => setDraft((current) => ({ ...current, hospitalNameAr: value }))} error={errors.hospitalNameAr} dir="rtl" />
          <InputField label="Hospital name (En)" value={draft.hospitalNameEn} onChange={(value) => setDraft((current) => ({ ...current, hospitalNameEn: value }))} dir="ltr" />
          <InputField label="Department name (Ar)" value={draft.departmentNameAr} onChange={(value) => setDraft((current) => ({ ...current, departmentNameAr: value }))} dir="rtl" />
          <InputField label="Department name (En)" value={draft.departmentNameEn} onChange={(value) => setDraft((current) => ({ ...current, departmentNameEn: value }))} dir="ltr" />
        </FieldCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FieldCard title={chooseLocalized(language, "الحقول الظاهرة", "Visible Fields")}>
          <ToggleGrid
            items={[
              ["showPatientCategory", chooseLocalized(language, "إظهار تصنيف المريض", "Show patient category")],
              ["showPatientName", chooseLocalized(language, "اسم المريض", "Patient name")],
              ["showMrn", "MRN"],
              ["showNationalId", chooseLocalized(language, "الرقم الوطني", "National ID")],
              ["showPhone", chooseLocalized(language, "الهاتف", "Phone")],
              ["showAgeSex", chooseLocalized(language, "العمر / الجنس", "Age / Sex")],
              ["showAppointmentNumber", chooseLocalized(language, "رقم الموعد", "Appointment number")],
              ["showAccessionNumber", chooseLocalized(language, "رقم الدخول", "Accession number")],
              ["showModality", chooseLocalized(language, "نوع الجهاز", "Modality")],
              ["showExamName", chooseLocalized(language, "اسم الفحص", "Exam name")],
              ["showDate", chooseLocalized(language, "التاريخ", "Date")],
              ["showTime", chooseLocalized(language, "الوقت", "Time")],
              ["showWalkIn", chooseLocalized(language, "حالة Walk-in", "Walk-in")],
              ["showLocation", chooseLocalized(language, "الموقع", "Location")],
              ["showArrivalNote", chooseLocalized(language, "ملاحظة الحضور", "Arrival note")],
            ]}
            settings={draft}
            setSettings={setDraft}
          />
        </FieldCard>

        <FieldCard title="QR">
          <ToggleRow label={chooseLocalized(language, "إظهار QR على الوصل", "Show QR on slip")} checked={draft.showQrCode} onChange={(checked) => setDraft((current) => ({ ...current, showQrCode: checked }))} />
          <div className="grid grid-cols-2 gap-3">
            <InputField label="QR caption (Ar)" value={draft.qrCaptionAr} onChange={(value) => setDraft((current) => ({ ...current, qrCaptionAr: value }))} dir="rtl" />
            <InputField label="QR caption (En)" value={draft.qrCaptionEn} onChange={(value) => setDraft((current) => ({ ...current, qrCaptionEn: value }))} dir="ltr" />
            <TextareaField label="QR helper (Ar)" value={draft.qrHelperTextAr} onChange={(value) => setDraft((current) => ({ ...current, qrHelperTextAr: value }))} dir="rtl" />
            <TextareaField label="QR helper (En)" value={draft.qrHelperTextEn} onChange={(value) => setDraft((current) => ({ ...current, qrHelperTextEn: value }))} dir="ltr" />
          </div>
        </FieldCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FieldCard title={chooseLocalized(language, "العناوين والتسميات", "Headings & Captions")}>
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Slip title (Ar)" value={draft.slipTitleAr} onChange={(value) => setDraft((current) => ({ ...current, slipTitleAr: value }))} dir="rtl" />
            <InputField label="Slip title (En)" value={draft.slipTitleEn} onChange={(value) => setDraft((current) => ({ ...current, slipTitleEn: value }))} dir="ltr" />
            <InputField label="Patient details heading (Ar)" value={draft.patientDetailsHeadingAr} onChange={(value) => setDraft((current) => ({ ...current, patientDetailsHeadingAr: value }))} dir="rtl" />
            <InputField label="Patient details heading (En)" value={draft.patientDetailsHeadingEn} onChange={(value) => setDraft((current) => ({ ...current, patientDetailsHeadingEn: value }))} dir="ltr" />
            <InputField label="Appointment details heading (Ar)" value={draft.appointmentDetailsHeadingAr} onChange={(value) => setDraft((current) => ({ ...current, appointmentDetailsHeadingAr: value }))} dir="rtl" />
            <InputField label="Appointment details heading (En)" value={draft.appointmentDetailsHeadingEn} onChange={(value) => setDraft((current) => ({ ...current, appointmentDetailsHeadingEn: value }))} dir="ltr" />
            <InputField label="Instructions heading (Ar)" value={draft.instructionsHeadingAr} onChange={(value) => setDraft((current) => ({ ...current, instructionsHeadingAr: value }))} dir="rtl" />
            <InputField label="Instructions heading (En)" value={draft.instructionsHeadingEn} onChange={(value) => setDraft((current) => ({ ...current, instructionsHeadingEn: value }))} dir="ltr" />
            <InputField label="Modality instructions heading (Ar)" value={draft.modalityInstructionsHeadingAr} onChange={(value) => setDraft((current) => ({ ...current, modalityInstructionsHeadingAr: value }))} dir="rtl" />
            <InputField label="Modality instructions heading (En)" value={draft.modalityInstructionsHeadingEn} onChange={(value) => setDraft((current) => ({ ...current, modalityInstructionsHeadingEn: value }))} dir="ltr" />
            <InputField label="Exam instructions heading (Ar)" value={draft.examInstructionsHeadingAr} onChange={(value) => setDraft((current) => ({ ...current, examInstructionsHeadingAr: value }))} dir="rtl" />
            <InputField label="Exam instructions heading (En)" value={draft.examInstructionsHeadingEn} onChange={(value) => setDraft((current) => ({ ...current, examInstructionsHeadingEn: value }))} dir="ltr" />
            <InputField label="Location heading (Ar)" value={draft.locationHeadingAr} onChange={(value) => setDraft((current) => ({ ...current, locationHeadingAr: value }))} dir="rtl" />
            <InputField label="Location heading (En)" value={draft.locationHeadingEn} onChange={(value) => setDraft((current) => ({ ...current, locationHeadingEn: value }))} dir="ltr" />
          </div>
        </FieldCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <FieldCard title={chooseLocalized(language, "باركود قائمة الانتظار", "Queue Barcode")}>
          <ToggleRow label={chooseLocalized(language, "إظهار الباركود", "Show barcode")} checked={draft.showAccessionBarcode} onChange={(checked) => setDraft((current) => ({ ...current, showAccessionBarcode: checked }))} />
          <SelectField
            label={chooseLocalized(language, "مصدر قيمة الباركود", "Barcode value mode")}
            value={draft.barcodeValueMode}
            onChange={(value) => setDraft((current) => ({ ...current, barcodeValueMode: value as AppointmentSlipSettings["barcodeValueMode"] }))}
            options={[
              { value: "accessionNumber", label: chooseLocalized(language, "رقم الدخول", "Accession number") },
              { value: "appointmentNumber", label: chooseLocalized(language, "رقم الموعد", "Appointment number") },
              { value: "bookingId", label: "Booking ID" },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Barcode caption (Ar)" value={draft.barcodeCaptionAr} onChange={(value) => setDraft((current) => ({ ...current, barcodeCaptionAr: value }))} dir="rtl" />
            <InputField label="Barcode caption (En)" value={draft.barcodeCaptionEn} onChange={(value) => setDraft((current) => ({ ...current, barcodeCaptionEn: value }))} dir="ltr" />
          </div>
        </FieldCard>

        <FieldCard title={chooseLocalized(language, "التعليمات والموقع", "Instructions & Location")}>
          <ToggleRow label={chooseLocalized(language, "إظهار تعليمات الجهاز", "Show modality instructions")} checked={draft.showModalityInstructions} onChange={(checked) => setDraft((current) => ({ ...current, showModalityInstructions: checked }))} />
          <ToggleRow label={chooseLocalized(language, "إظهار تعليمات الفحص", "Show exam instructions")} checked={draft.showExamSpecificInstructions} onChange={(checked) => setDraft((current) => ({ ...current, showExamSpecificInstructions: checked }))} />
          <NumberField
            label={chooseLocalized(language, "الحد الأقصى لأسطر التعليمات", "Max instruction lines on slip")}
            value={draft.maxInstructionLinesOnSlip}
            onChange={(value) => setDraft((current) => ({ ...current, maxInstructionLinesOnSlip: value }))}
            error={errors.maxInstructionLinesOnSlip}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextareaField label="Fallback instructions (Ar)" value={draft.fallbackInstructionTextAr} onChange={(value) => setDraft((current) => ({ ...current, fallbackInstructionTextAr: value }))} dir="rtl" />
            <TextareaField label="Fallback instructions (En)" value={draft.fallbackInstructionTextEn} onChange={(value) => setDraft((current) => ({ ...current, fallbackInstructionTextEn: value }))} dir="ltr" />
            <TextareaField label="Location text (Ar)" value={draft.locationTextAr} onChange={(value) => setDraft((current) => ({ ...current, locationTextAr: value }))} dir="rtl" />
            <TextareaField label="Location text (En)" value={draft.locationTextEn} onChange={(value) => setDraft((current) => ({ ...current, locationTextEn: value }))} dir="ltr" />
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

function getQrDependencyWarning(settings?: PatientQrSettings): string {
  if (!settings) return "";
  if (!settings.enabled) {
    return "Patient QR page is disabled. The printed QR will stay suppressed until Patient QR Settings enables the patient page again.";
  }
  if (!settings.printQrOnAppointmentSlip) {
    return "Patient QR Settings currently suppress slip QR printing. Change that there if this slip should include the QR.";
  }
  return "";
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

function ToggleGrid(props: {
  items: Array<[keyof AppointmentSlipSettings, string]>;
  settings: AppointmentSlipSettings;
  setSettings: Dispatch<SetStateAction<AppointmentSlipSettings>>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {props.items.map(([key, label]) => (
        <ToggleRow
          key={String(key)}
          label={label}
          checked={Boolean(props.settings[key])}
          onChange={(checked) => props.setSettings((current) => ({ ...current, [key]: checked }))}
        />
      ))}
    </div>
  );
}

function InputField(props: { label: string; value: string; onChange: (value: string) => void; dir?: string; error?: string }) {
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

function NumberField(props: { label: string; value: number; onChange: (value: number) => void; error?: string; step?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {props.label}
      </label>
      <input
        id={id}
        type="number"
        step={props.step ?? "1"}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
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

function TextareaField(props: { label: string; value: string; onChange: (value: string) => void; dir?: string }) {
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
        {chooseLocalized(language, "يلزم تأكيد صلاحية المشرف قبل تعديل إعدادات وصل الموعد.", "Supervisor re-authentication is required before modifying appointment slip settings.")}
      </p>
      <button type="button" onClick={onReAuthRequired} className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
        {chooseLocalized(language, "إعادة التحقق", "Re-authenticate")}
      </button>
    </div>
  );
}
