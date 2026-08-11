import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/shared/Button";
import { fetchSettings, saveSettings } from "@/lib/api-hooks";
import type { TranslationKey } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";
import { mutationErrorMessage } from "./settings-section-utils";

// -- Settings Catalog: known keys → display labels, control types, and dropdown options --
interface SettingControl {
  label: string;
  type: "dropdown" | "number" | "time" | "text";
  options?: { value: string; label: string }[];
  min?: string;
  max?: string;
  step?: string;
}

const SETTINGS_CATALOG: Record<string, SettingControl> = {
  // Patient Registration
  phone1_required: { label: "", type: "dropdown", options: [
    { value: "required", label: "مطلوب" },
    { value: "optional", label: "اختياري" }
  ]},
  dob_or_age_rule: { label: "DOB / Age Rule", type: "dropdown", options: [
    { value: "age_or_dob_required", label: "العمر أو تاريخ الميلاد مطلوب" },
    { value: "age_required", label: "العمر مطلوب" },
    { value: "dob_required", label: "تاريخ الميلاد مطلوب" }
  ]},
  national_id_required: { label: "", type: "dropdown", options: [
    { value: "required", label: "مطلوب" },
    { value: "optional", label: "اختياري" }
  ]},
  custom_fields_scope: { label: "نطاق الحقول المخصصة", type: "dropdown", options: [
    { value: "all_patients", label: "جميع المرضى" },
    { value: "disabled", label: "غير مفعل" }
  ]},

  // Scheduling & Capacity
  capacity_mode: { label: "وضع السعة", type: "dropdown", options: [
    { value: "per_modality_per_day", label: "لكل جهاز في اليوم" },
    { value: "global", label: "إجمالي" }
  ]},
  calendar_window_days: { label: "نافذة التقويم (أيام)", type: "number", min: "1", max: "90" },
  double_booking_prevention: { label: "منع الحجز المزدوج", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  overbooking_reason_required: { label: "اشتراط سبب للتجاوز", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  allow_friday_appointments: { label: "السماح بمواعيد الجمعة (للحجز العادي)", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  allow_saturday_appointments: { label: "السماح بمواعيد السبت (للحجز العادي)", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  exam_type_change_policy: { label: "تغيير نوع الفحص", type: "dropdown", options: [
    { value: "allowed_without_supervisor", label: "مسموح بدون مشرف" },
    { value: "supervisor_required", label: "يتطلب اعتماد مشرف" },
    { value: "disabled", label: "غير مسموح" }
  ]},
  allow_reception_override_requests_from_availability: { label: "Reception override requests from availability / طلبات تجاوز الاستقبال من شاشة التوفر", type: "dropdown", options: [
    { value: "enabled", label: "Enabled / مفعل" },
    { value: "disabled", label: "Disabled / غير مفعل" }
  ]},
  // Queue & Arrival
  barcode_check_in: { label: "تسجيل الوصول بالباركود", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  walk_in_queue: { label: "قائمة الدخول المباشر", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  no_show_review_time: { label: "وقت مراجعة الغياب", type: "time" },
  auto_no_show_enabled: { label: "Automatic no-show after review time / تحويل الغياب تلقائياً بعد وقت المراجعة", type: "dropdown", options: [
    { value: "enabled", label: "Enabled / مفعل" },
    { value: "disabled", label: "Disabled / غير مفعل" }
  ]},
  no_show_confirmation_required: { label: "Require manual no-show confirmation / اشتراط تأكيد الغياب يدوياً", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  auto_no_show_cleanup_days: { label: "Old no-show cleanup days / تنظيف مواعيد الغياب القديمة", type: "number", min: "0", max: "30" }
  , no_show_grace_minutes: { label: "No-show booking-time grace (minutes)", type: "number", min: "0", max: "720" },
};

function inferSettingControl(key: string, value: string): SettingControl {
  const known = SETTINGS_CATALOG[key];
  if (known) return known;

  // Fallback inference for unknown keys
  const strVal = String(value).toLowerCase();
  if (strVal === "enabled" || strVal === "disabled") {
    return { label: key.replace(/_/g, " "), type: "dropdown", options: [
      { value: "enabled", label: "Enabled" },
      { value: "disabled", label: "Disabled" }
    ]};
  }
  if (strVal === "required" || strVal === "optional") {
    return { label: key.replace(/_/g, " "), type: "dropdown", options: [
      { value: "required", label: "Required" },
      { value: "optional", label: "Optional" }
    ]};
  }
  if (/^\d+$/.test(strVal)) {
    return { label: key.replace(/_/g, " "), type: "number" };
  }
  if (/^\d{2}:\d{2}$/.test(strVal)) {
    return { label: key.replace(/_/g, " "), type: "time" };
  }
  return { label: key.replace(/_/g, " "), type: "text" };
}

function friendlySettingLabel(category: string, key: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  if (category === "patient_registration" && key === "mrn_prefix") {
    return t("settings.patientRegistration.mrnPrefix");
  }
  if (category === "patient_registration" && key === "national_id_required") {
    return t("settings.patientRegistration.identifierRequired");
  }
  if (category === "patient_registration" && key === "phone1_required") {
    return t("settings.patientRegistration.phone1Required");
  }
  return key.replace(/_/g, " ");
}

type SimpleSettingEntry = {
  key: string;
  value: string;
};

function MrnPrefixSettingEditor({
  initialValue,
  isPending,
  onSave,
}: {
  initialValue: string;
  isPending: boolean;
  onSave: (value: string) => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(initialValue);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-amber-800">{t("settings.patientRegistration.mrnPrefix")}</p>
        <p className="text-sm text-amber-700 mt-1">{t("settings.patientRegistration.mrnPrefixHint")}</p>
        <p className="text-sm text-amber-700 mt-2">{t("settings.patientRegistration.requiredFieldsHint")}</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 mb-1.5">
            {t("settings.patientRegistration.mrnPrefix")}
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("settings.patientRegistration.mrnPrefix")}
            className="w-full px-3 py-2 text-sm rounded-lg border border-amber-200 bg-white text-stone-900 outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <Button
          type="button"
          onClick={() => onSave(value)}
          disabled={isPending}
          className="sm:min-w-32"
        >
          {isPending ? t("settings.loading") : t("settings.save")}
        </Button>
      </div>
    </div>
  );
}

export default function SimpleSettingsSection({ category, onReAuthRequired }: { category: string; onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["settings", category], queryFn: () => fetchSettings(category) });

  const [mutationError, setMutationError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: (payload: { entries: SimpleSettingEntry[] }) => saveSettings(category, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", category] });
      if (category === "patient_registration") {
        queryClient.invalidateQueries({ queryKey: ["patient-mrn-preview"] });
      }
      if (category === "scheduling_and_capacity") {
        queryClient.invalidateQueries({ queryKey: ["v2-availability"] });
      }
      setMutationError(null);
    },
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Save failed")); }
  });

  const handleSave = (key: string, value: string) => {
    saveMutation.mutate({ entries: [{ key, value }] });
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", category])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  const settingsValues: Record<string, string> = data ?? {};
  const serverMrnPrefix = String(data?.mrn_prefix ?? "");

  return (
    <div className="space-y-3">
      {category === "patient_registration" && (
        <MrnPrefixSettingEditor
          key={`mrn-prefix:${serverMrnPrefix}`}
          initialValue={serverMrnPrefix}
          isPending={saveMutation.isPending}
          onSave={(value) => saveMutation.mutate({ entries: [{ key: "mrn_prefix", value }] })}
        />
      )}
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}
      {Object.entries(settingsValues)
        .filter(([key]) => !(category === "patient_registration" && key === "mrn_prefix"))
        .map(([key, value]) => {
        const control = inferSettingControl(key, value);
        const label = control.label || friendlySettingLabel(category, key, t);
        const isPending = saveMutation.variables?.entries?.some((e) => e.key === key) && saveMutation.isPending;
        return (
          <div key={key} className="flex items-center justify-between p-3 bg-stone-50 dark:bg-stone-700 rounded-lg">
            <span className="text-stone-700 dark:text-stone-300 font-medium text-sm">{label}</span>
            <div className="flex items-center gap-2">
              {control.type === "dropdown" && control.options && (
                <select
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50"
                >
                  {control.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              {control.type === "number" && (
                <input
                  type="number"
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  className="w-20 px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50 text-right"
                />
              )}
              {control.type === "time" && (
                <input
                  type="time"
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50"
                />
              )}
              {control.type === "text" && (
                <span className="text-stone-900 dark:text-white text-sm">{String(value)}</span>
              )}
              {isPending && (
                <span className="w-4 h-4 border-2 border-stone-300 border-t-teal-600 rounded-full animate-spin" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
