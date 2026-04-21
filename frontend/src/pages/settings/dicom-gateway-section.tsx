import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLanguage } from "@/providers/language-provider";
import { fetchSettings, saveSettings } from "@/lib/api-hooks";

interface DicomGatewaySectionProps {
  onReAuthRequired: (key: string[]) => void;
}

export default function DicomGatewaySettingsSection({ onReAuthRequired }: DicomGatewaySectionProps) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "dicom_gateway"],
    queryFn: () => fetchSettings("dicom_gateway")
  });

  // fetchSettings returns a flat Record<string, string> via mapSettings
  const settingsMap = (data as Record<string, string>) || {};

  const [form, setForm] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (entries: Array<{ key: string; value: { value: string } }>) => {
      return saveSettings("dicom_gateway", { entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "dicom_gateway"] });
      setIsEditing(false);
      setForm({});
      setMutationError(null);
      setStatusMessage(language === "ar" ? "تم حفظ الإعدادات بنجاح." : "Settings saved successfully.");
      setTimeout(() => setStatusMessage(null), 3000);
    },
    onError: (err: Error) => {
      setMutationError(err.message || (language === "ar" ? "فشل الحفظ" : "Save failed"));
    }
  });

  const handleSave = () => {
    const entries = Object.entries(form).map(([key, value]) => ({
      key,
      value: { value }
    }));

    if (entries.length === 0) {
      setIsEditing(false);
      return;
    }

    saveMutation.mutate(entries);
  };

  const handleResetDefaults = async () => {
    try {
      const response = await fetch("/api/dicom/reset-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        throw new Error(language === "ar" ? "فشل إعادة الضبط" : "Failed to reset defaults");
      }

      queryClient.invalidateQueries({ queryKey: ["settings", "dicom_gateway"] });
      setStatusMessage(language === "ar" ? "تمت إعادة الإعدادات إلى القيم الافتراضية." : "Settings reset to defaults.");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setMutationError((err as Error).message);
    }
  };

  const handleRotateSecret = async () => {
    if (!confirm(language === "ar" ? "هل تريد تدوير سر الاستدعاء؟ قد يؤدي ذلك إلى تعطيل اتصالات DICOM الحالية." : "Are you sure you want to rotate the callback secret? This may break existing DICOM connections.")) {
      return;
    }

    try {
      const response = await fetch("/api/dicom/rotate-secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        throw new Error(language === "ar" ? "فشل تدوير السر" : "Failed to rotate secret");
      }

      queryClient.invalidateQueries({ queryKey: ["settings", "dicom_gateway"] });
      setStatusMessage(language === "ar" ? "تم تدوير سر الاستدعاء." : "Callback secret rotated.");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setMutationError((err as Error).message);
    }
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "dicom_gateway"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">{t("settings.loading")}</p>;
  }

  const getField = (key: string) => form[key] ?? settingsMap[key] ?? "";

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIsEditing(true);
  };

  return (
    <div className="space-y-6">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">{language === "ar" ? "إخفاء" : "Dismiss"}</button>
        </div>
      )}

      {statusMessage && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-sm">
          {statusMessage}
        </div>
      )}

      {/* Gateway Settings */}
      <div className="space-y-4">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">{language === "ar" ? "بوابة DICOM" : "DICOM Gateway"}</h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SettingField
            label={language === "ar" ? "مفعّل" : "Enabled"}
            type="select"
            options={[
              { value: "enabled", label: language === "ar" ? "مفعّل" : "Enabled" },
              { value: "disabled", label: language === "ar" ? "معطّل" : "Disabled" }
            ]}
            value={getField("enabled")}
            onChange={(v) => updateField("enabled", v)}
          />

          <SettingField
            label={language === "ar" ? "عنوان الربط" : "Bind Host"}
            value={getField("bind_host")}
            onChange={(v) => updateField("bind_host", v)}
            placeholder="127.0.0.1"
          />

          <SettingField
            label={language === "ar" ? "عنوان AE لقائمة العمل" : "Worklist AE Title"}
            value={getField("mwl_ae_title")}
            onChange={(v) => updateField("mwl_ae_title", v.toUpperCase())}
            placeholder="RISPRO_MWL"
            maxLength={16}
          />

          <SettingField
            label={language === "ar" ? "منفذ قائمة العمل" : "Worklist Port"}
            type="number"
            value={getField("mwl_port")}
            onChange={(v) => updateField("mwl_port", v)}
            placeholder="11112"
          />

          <SettingField
            label={language === "ar" ? "سلوك إعادة البناء" : "Rebuild Behavior"}
            type="select"
            options={[
              { value: "incremental_on_write", label: language === "ar" ? "تدريجي عند الكتابة" : "Incremental on Write" },
              { value: "full_rebuild", label: language === "ar" ? "إعادة بناء كاملة" : "Full Rebuild" }
            ]}
            value={getField("rebuild_behavior")}
            onChange={(v) => updateField("rebuild_behavior", v)}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700 dark:text-stone-300">{language === "ar" ? "سر الاستدعاء" : "Callback Secret"}</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={getField("callback_secret")}
                readOnly
                className="flex-1 px-3 py-1.5 rounded border bg-stone-100 dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
              />
              <button
                onClick={handleRotateSecret}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded transition-colors"
              >
                {language === "ar" ? "تدوير" : "Rotate"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Storage Paths */}
      <div className="space-y-4">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">{language === "ar" ? "مسارات التخزين" : "Storage Paths"}</h4>

        <div className="grid grid-cols-1 gap-4">
          <SettingField
            label={language === "ar" ? "مجلد مصدر قائمة العمل" : "Worklist Source Directory"}
            value={getField("worklist_source_dir")}
            onChange={(v) => updateField("worklist_source_dir", v)}
            placeholder="storage/dicom/worklist-source"
          />

          <SettingField
            label={language === "ar" ? "مجلد إخراج قائمة العمل" : "Worklist Output Directory"}
            value={getField("worklist_output_dir")}
            onChange={(v) => updateField("worklist_output_dir", v)}
            placeholder="storage/dicom/worklists"
          />
        </div>
      </div>

      {/* External Tools */}
      <div className="space-y-4">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">{language === "ar" ? "الأدوات الخارجية" : "External Tools"}</h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SettingField
            label={language === "ar" ? "أمر dump2dcm" : "dump2dcm Command"}
            value={getField("dump2dcm_command")}
            onChange={(v) => updateField("dump2dcm_command", v)}
            placeholder="dump2dcm"
          />

          <SettingField
            label={language === "ar" ? "أمر dcmdump" : "dcmdump Command"}
            value={getField("dcmdump_command")}
            onChange={(v) => updateField("dcmdump_command", v)}
            placeholder="dcmdump"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !isEditing}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {saveMutation.isPending ? (language === "ar" ? "جاري الحفظ..." : "Saving...") : (language === "ar" ? "حفظ الإعدادات" : "Save Settings")}
          </button>

          <button
            onClick={handleResetDefaults}
            className="btn-secondary text-sm"
          >
            {language === "ar" ? "إعادة الضبط للقيم الافتراضية" : "Reset to Defaults"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  maxLength,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "select";
  placeholder?: string;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</label>

      {type === "select" ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        >
          {options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
        />
      )}
    </div>
  );
}

function QueryError({ message }: { message: string }) {
  const { t } = useLanguage();
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">{t("settings.failedLoad")}</p>
      <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono break-all">{message}</p>
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t("settings.reauthRequired")}</p>
      <p className="text-xs text-amber-600 dark:text-amber-400">{t("settings.reauthHelp")}</p>
      <button onClick={onReAuthRequired} className="btn-primary text-sm">
        {t("common.reAuthenticate")}
      </button>
    </div>
  );
}
