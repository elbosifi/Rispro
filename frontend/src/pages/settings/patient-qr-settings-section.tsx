import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Save, Trash2, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { fetchPatientQrSettings, savePatientQrSettings, type PatientQrSettings } from "@/lib/api-hooks";

interface PatientQrSettingsSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

const DEFAULT_SETTINGS: PatientQrSettings = {
  enabled: true,
  printQrOnAppointmentSlip: true,
  allowCancellation: true,
  allowAddToCalendar: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: false,
  showLocationDirections: false,
  pageTitleAr: "خدمة المريض عبر رمز QR",
  introTextAr: "يمكنك مراجعة تفاصيل الموعد والتعليمات ومعلومات القسم من هذه الصفحة.",
  genericPreparationTextAr: "",
  documentsChecklistAr: [
    "ورقة الإحالة",
    "إثبات الهوية",
    "صور أو تقارير سابقة إن وجدت",
    "تحاليل حديثة إذا طُلبت من القسم",
  ],
  contact: {
    primaryPhone: "",
    secondaryPhone: "",
    whatsapp: "",
    whatsappEnabled: false,
    workingHoursAr: "",
    noteAr: "",
  },
  location: {
    centerNameAr: "المركز الوطني للأورام بنغازي",
    departmentLocationAr: "",
    roomUnitFloorAr: "",
    addressAr: "",
    arrivalInstructionsAr: "",
    googleMapsUrl: "",
    parkingNoteAr: "",
  },
};

function cloneSettings(settings: PatientQrSettings): PatientQrSettings {
  return {
    ...settings,
    documentsChecklistAr: [...settings.documentsChecklistAr],
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
    // eslint-disable-next-line no-new
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

export default function PatientQrSettingsSection({ onReAuthRequired }: PatientQrSettingsSectionProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["patient-qr-settings"],
    queryFn: fetchPatientQrSettings,
  });
  const [draft, setDraft] = useState<PatientQrSettings>(DEFAULT_SETTINGS);
  const [newChecklistItem, setNewChecklistItem] = useState("");
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
  });

  const canSave = useMemo(() => {
    const nextErrors: Record<string, string> = {};
    if (!isValidPhone(draft.contact.primaryPhone)) nextErrors.contactPrimaryPhone = "رقم الهاتف غير صالح.";
    if (!isValidPhone(draft.contact.secondaryPhone)) nextErrors.contactSecondaryPhone = "رقم الهاتف غير صالح.";
    if (!isValidPhone(draft.contact.whatsapp)) nextErrors.contactWhatsapp = "رقم الواتساب غير صالح.";
    if (!isValidUrl(draft.location.googleMapsUrl)) nextErrors.googleMapsUrl = "رابط خرائط Google غير صالح.";
    if (draft.documentsChecklistAr.some((item) => !item.trim())) nextErrors.checklist = "جميع عناصر القائمة يجب أن تكون غير فارغة.";
    return { ok: Object.keys(nextErrors).length === 0, nextErrors };
  }, [draft]);

  const updateChecklistItem = (index: number, value: string) => {
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistAr[index] = value;
      return next;
    });
  };

  const moveChecklistItem = (index: number, direction: -1 | 1) => {
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

  const removeChecklistItem = (index: number) => {
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistAr.splice(index, 1);
      return next;
    });
  };

  const addChecklistItem = () => {
    const value = newChecklistItem.trim();
    if (!value) return;
    setDraft((current) => {
      const next = cloneSettings(current);
      next.documentsChecklistAr.push(value);
      return next;
    });
    setNewChecklistItem("");
  };

  const handleSave = () => {
    setErrors(canSave.nextErrors);
    if (!canSave.ok) return;
    mutation.mutate({
      ...draft,
      documentsChecklistAr: draft.documentsChecklistAr.map((item) => item.trim()).filter(Boolean),
      contact: {
        ...draft.contact,
        primaryPhone: draft.contact.primaryPhone.trim(),
        secondaryPhone: draft.contact.secondaryPhone.trim(),
        whatsapp: draft.contact.whatsapp.trim(),
        workingHoursAr: draft.contact.workingHoursAr.trim(),
        noteAr: draft.contact.noteAr.trim(),
      },
      location: {
        ...draft.location,
        centerNameAr: draft.location.centerNameAr.trim(),
        departmentLocationAr: draft.location.departmentLocationAr.trim(),
        roomUnitFloorAr: draft.location.roomUnitFloorAr.trim(),
        addressAr: draft.location.addressAr.trim(),
        arrivalInstructionsAr: draft.location.arrivalInstructionsAr.trim(),
        googleMapsUrl: draft.location.googleMapsUrl.trim(),
        parkingNoteAr: draft.location.parkingNoteAr.trim(),
      },
    });
  };

  if (isLoading) {
    return <p className="text-sm text-slate-500">جاري تحميل إعدادات صفحة QR...</p>;
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
        تعذر تحميل إعدادات صفحة QR.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
        <h4 className="text-base font-extrabold text-slate-900">إعدادات صفحة المريض ورمز QR</h4>
        <p className="mt-1 text-sm leading-7 text-slate-600">
          تحكم في ظهور الصفحة، قسم الإلغاء، التقويم، التعليمات، قائمة المستندات، ومعلومات التواصل والموقع.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FieldCard title="التحكم العام">
          <ToggleRow label="تفعيل صفحة QR للمرضى" checked={draft.enabled} onChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))} />
          <ToggleRow label="طباعة رمز QR على ورقة الموعد" checked={draft.printQrOnAppointmentSlip} onChange={(checked) => setDraft((current) => ({ ...current, printQrOnAppointmentSlip: checked }))} />
          <ToggleRow label="السماح بإلغاء الموعد" checked={draft.allowCancellation} onChange={(checked) => setDraft((current) => ({ ...current, allowCancellation: checked }))} />
          <ToggleRow label="إضافة إلى التقويم" checked={draft.allowAddToCalendar} onChange={(checked) => setDraft((current) => ({ ...current, allowAddToCalendar: checked }))} />
        </FieldCard>

        <FieldCard title="محتوى الصفحة">
          <label className="block text-sm font-semibold text-slate-700">عنوان الصفحة</label>
          <input
            value={draft.pageTitleAr}
            onChange={(e) => setDraft((current) => ({ ...current, pageTitleAr: e.target.value }))}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          />

          <label className="mt-3 block text-sm font-semibold text-slate-700">مقدمة الصفحة</label>
          <textarea
            value={draft.introTextAr}
            onChange={(e) => setDraft((current) => ({ ...current, introTextAr: e.target.value }))}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          />

          <label className="mt-3 block text-sm font-semibold text-slate-700">نص التحضير العام</label>
          <textarea
            value={draft.genericPreparationTextAr}
            onChange={(e) => setDraft((current) => ({ ...current, genericPreparationTextAr: e.target.value }))}
            rows={3}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        </FieldCard>
      </div>

      <FieldCard title="تعليمات التحضير">
        <ToggleRow label="إظهار تعليمات التحضير" checked={draft.showPreparationInstructions} onChange={(checked) => setDraft((current) => ({ ...current, showPreparationInstructions: checked }))} />
        <p className="mt-2 text-sm leading-7 text-slate-600">
          تظهر تعليمات الجهاز وتعليمات الفحص كلٌ على حدة عندما تكون متاحة، ويستخدم هذا النص العام كبديل عند الحاجة.
        </p>
      </FieldCard>

      <FieldCard title="قائمة المستندات المطلوبة">
        <ToggleRow label="إظهار قائمة المستندات" checked={draft.showDocumentsChecklist} onChange={(checked) => setDraft((current) => ({ ...current, showDocumentsChecklist: checked }))} />
        <div className="mt-3 space-y-2">
          {draft.documentsChecklistAr.map((item, index) => (
            <div key={`${index}-${item}`} className="flex items-center gap-2">
              <input
                value={item}
                onChange={(e) => updateChecklistItem(index, e.target.value)}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => moveChecklistItem(index, -1)}
                aria-label="تحريك العنصر إلى الأعلى"
                className="rounded-xl border border-slate-300 bg-white p-2 text-slate-700"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => moveChecklistItem(index, 1)}
                aria-label="تحريك العنصر إلى الأسفل"
                className="rounded-xl border border-slate-300 bg-white p-2 text-slate-700"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => removeChecklistItem(index)}
                aria-label="حذف العنصر"
                className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-rose-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              value={newChecklistItem}
              onChange={(e) => setNewChecklistItem(e.target.value)}
              placeholder="إضافة عنصر جديد..."
              className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <button type="button" onClick={addChecklistItem} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">
              <Plus className="inline h-4 w-4" /> إضافة
            </button>
          </div>
          {errors.checklist ? <p className="text-sm text-rose-700">{errors.checklist}</p> : null}
        </div>
      </FieldCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <FieldCard title="التواصل مع القسم">
          <ToggleRow label="إظهار بطاقة التواصل" checked={draft.showDepartmentContact} onChange={(checked) => setDraft((current) => ({ ...current, showDepartmentContact: checked }))} />
          <Input label="رقم الهاتف الرئيسي" value={draft.contact.primaryPhone} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, primaryPhone: value } }))} error={errors.contactPrimaryPhone} />
          <Input label="رقم الهاتف الثاني" value={draft.contact.secondaryPhone} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, secondaryPhone: value } }))} error={errors.contactSecondaryPhone} />
          <ToggleRow label="تفعيل الواتساب" checked={draft.contact.whatsappEnabled} onChange={(checked) => setDraft((current) => ({ ...current, contact: { ...current.contact, whatsappEnabled: checked } }))} />
          <Input label="رقم الواتساب" value={draft.contact.whatsapp} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, whatsapp: value } }))} error={errors.contactWhatsapp} />
          <Input label="ساعات العمل" value={draft.contact.workingHoursAr} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, workingHoursAr: value } }))} />
          <Textarea label="ملاحظة قصيرة" value={draft.contact.noteAr} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, noteAr: value } }))} />
        </FieldCard>

        <FieldCard title="الموقع والدخول">
          <ToggleRow label="إظهار بطاقة الموقع" checked={draft.showLocationDirections} onChange={(checked) => setDraft((current) => ({ ...current, showLocationDirections: checked }))} />
          <Input label="اسم المركز" value={draft.location.centerNameAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, centerNameAr: value } }))} />
          <Textarea label="اسم القسم / الموقع" value={draft.location.departmentLocationAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, departmentLocationAr: value } }))} />
          <Input label="الطابق / الوحدة / الغرفة" value={draft.location.roomUnitFloorAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, roomUnitFloorAr: value } }))} />
          <Textarea label="العنوان" value={draft.location.addressAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, addressAr: value } }))} />
          <Textarea label="إرشادات الوصول" value={draft.location.arrivalInstructionsAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, arrivalInstructionsAr: value } }))} />
          <Input label="رابط خرائط Google" value={draft.location.googleMapsUrl} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, googleMapsUrl: value } }))} error={errors.googleMapsUrl} />
          <Textarea label="ملاحظة إضافية" value={draft.location.parkingNoteAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, parkingNoteAr: value } }))} />
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
          حفظ
        </button>
      </div>
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

function Input(props: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {props.label}
      </label>
      <input
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      {props.error ? <p className="mt-1 text-sm text-rose-700">{props.error}</p> : null}
    </div>
  );
}

function Textarea(props: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {props.label}
      </label>
      <textarea
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h4 className="text-base font-extrabold text-amber-900">إعادة التحقق مطلوبة</h4>
      <p className="mt-1 text-sm leading-7 text-amber-800">
        يلزم تأكيد صلاحية المشرف قبل تعديل إعدادات صفحة QR.
      </p>
      <button
        type="button"
        onClick={onReAuthRequired}
        className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
      >
        إعادة التحقق
      </button>
    </div>
  );
}
