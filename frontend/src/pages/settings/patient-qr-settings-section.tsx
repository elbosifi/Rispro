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
  showBookingTime: true,
  showPreparationInstructions: true,
  showDocumentsChecklist: true,
  showDepartmentContact: false,
  showLocationDirections: false,
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
          <ToggleRow label="إظهار وقت الموعد في صفحة QR" checked={draft.showBookingTime} onChange={(checked) => setDraft((current) => ({ ...current, showBookingTime: checked }))} />
        </FieldCard>

        <FieldCard title="محتوى الصفحة">
          <label className="block text-sm font-semibold text-slate-700">عنوان الصفحة</label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <input
              dir="ltr"
              value={draft.pageTitleEn}
              onChange={(e) => setDraft((current) => ({ ...current, pageTitleEn: e.target.value }))}
              placeholder="Page title (English)"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-ltr"
            />
            <input
              dir="rtl"
              value={draft.pageTitleAr}
              onChange={(e) => setDraft((current) => ({ ...current, pageTitleAr: e.target.value }))}
              placeholder="عنوان الصفحة (عربي)"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-rtl"
            />
          </div>

          <label className="mt-3 block text-sm font-semibold text-slate-700">مقدمة الصفحة</label>
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

          <label className="mt-3 block text-sm font-semibold text-slate-700">نص التحضير العام</label>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <textarea
              dir="ltr"
              value={draft.genericPreparationTextEn}
              onChange={(e) => setDraft((current) => ({ ...current, genericPreparationTextEn: e.target.value }))}
              rows={3}
              placeholder="General preparation text (English)"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-ltr"
            />
            <textarea
              dir="rtl"
              value={draft.genericPreparationTextAr}
              onChange={(e) => setDraft((current) => ({ ...current, genericPreparationTextAr: e.target.value }))}
              rows={3}
              placeholder="نص التحضير العام (عربي)"
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm input-rtl"
            />
          </div>
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
        <p className="mt-2 text-sm font-semibold text-slate-700">العربية</p>
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

        <p className="mt-4 text-sm font-semibold text-slate-700">English</p>
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
        <FieldCard title="التواصل مع القسم">
          <ToggleRow label="إظهار بطاقة التواصل" checked={draft.showDepartmentContact} onChange={(checked) => setDraft((current) => ({ ...current, showDepartmentContact: checked }))} />
          <Input label="رقم الهاتف الرئيسي" value={draft.contact.primaryPhone} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, primaryPhone: value } }))} error={errors.contactPrimaryPhone} />
          <Input label="رقم الهاتف الثاني" value={draft.contact.secondaryPhone} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, secondaryPhone: value } }))} error={errors.contactSecondaryPhone} />
          <ToggleRow label="تفعيل الواتساب" checked={draft.contact.whatsappEnabled} onChange={(checked) => setDraft((current) => ({ ...current, contact: { ...current.contact, whatsappEnabled: checked } }))} />
          <Input label="رقم الواتساب" value={draft.contact.whatsapp} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, whatsapp: value } }))} error={errors.contactWhatsapp} />
          <div className="grid grid-cols-2 gap-2">
            <Input dir="ltr" label="Working Hours (En)" value={draft.contact.workingHoursEn} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, workingHoursEn: value } }))} />
            <Input dir="rtl" label="ساعات العمل" value={draft.contact.workingHoursAr} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, workingHoursAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label="Note (En)" value={draft.contact.noteEn} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, noteEn: value } }))} />
            <Textarea dir="rtl" label="ملاحظة قصيرة" value={draft.contact.noteAr} onChange={(value) => setDraft((current) => ({ ...current, contact: { ...current.contact, noteAr: value } }))} />
          </div>
        </FieldCard>

        <FieldCard title="الموقع والدخول">
          <ToggleRow label="إظهار بطاقة الموقع" checked={draft.showLocationDirections} onChange={(checked) => setDraft((current) => ({ ...current, showLocationDirections: checked }))} />
          <div className="grid grid-cols-2 gap-2">
            <Input dir="ltr" label="Center Name (En)" value={draft.location.centerNameEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, centerNameEn: value } }))} />
            <Input dir="rtl" label="اسم المركز" value={draft.location.centerNameAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, centerNameAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label="Department/Location (En)" value={draft.location.departmentLocationEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, departmentLocationEn: value } }))} />
            <Textarea dir="rtl" label="اسم القسم / الموقع" value={draft.location.departmentLocationAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, departmentLocationAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input dir="ltr" label="Floor/Unit/Room (En)" value={draft.location.roomUnitFloorEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, roomUnitFloorEn: value } }))} />
            <Input dir="rtl" label="الطابق / الوحدة / الغرفة" value={draft.location.roomUnitFloorAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, roomUnitFloorAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label="Address (En)" value={draft.location.addressEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, addressEn: value } }))} />
            <Textarea dir="rtl" label="العنوان" value={draft.location.addressAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, addressAr: value } }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label="Arrival Instructions (En)" value={draft.location.arrivalInstructionsEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, arrivalInstructionsEn: value } }))} />
            <Textarea dir="rtl" label="إرشادات الوصول" value={draft.location.arrivalInstructionsAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, arrivalInstructionsAr: value } }))} />
          </div>
          <Input label="رابط خرائط Google" value={draft.location.googleMapsUrl} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, googleMapsUrl: value } }))} error={errors.googleMapsUrl} />
          <div className="grid grid-cols-2 gap-2">
            <Textarea dir="ltr" label="Additional Note (En)" value={draft.location.parkingNoteEn} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, parkingNoteEn: value } }))} />
            <Textarea dir="rtl" label="ملاحظة إضافية" value={draft.location.parkingNoteAr} onChange={(value) => setDraft((current) => ({ ...current, location: { ...current.location, parkingNoteAr: value } }))} />
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
          حفظ
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
