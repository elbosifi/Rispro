import {
  resolveEffectiveNaps2ScanPreferences,
  type Naps2ScanPreferenceDefaults,
  type Naps2ScanPreferenceOverrides,
} from "@/services/scanning/workstation-naps2-settings";
import type { Naps2ScanSource } from "@/lib/naps2-webscan";
import { t as translate, type Language, type TranslationKey } from "@/lib/i18n";

export function ScanOptionsDisclosure({
  language,
  globalPreferences,
  overrides,
  onChange,
  disabled = false,
  className,
}: {
  language: Language;
  globalPreferences: Naps2ScanPreferenceDefaults;
  overrides: Naps2ScanPreferenceOverrides;
  onChange: (overrides: Naps2ScanPreferenceOverrides) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => translate(language, key, params);
  const workstationDefault = resolveEffectiveNaps2ScanPreferences(globalPreferences);
  const effective = resolveEffectiveNaps2ScanPreferences(globalPreferences, overrides);
  const sourceLabel = (source: Naps2ScanSource) => {
    if (source === "auto") return t("settings.documents.autoSource");
    if (source === "flatbed") return t("settings.documents.flatbed");
    if (source === "duplex") return t("settings.documents.duplex");
    return t("settings.documents.feeder");
  };
  const colorLabel = (colorMode: "grayscale" | "color") => t(colorMode === "color" ? "settings.documents.color" : "settings.documents.grayscale");
  const effectiveSummary = t("scanPreferences.effective", {
    source: sourceLabel(effective.source),
    dpi: effective.dpi,
    colorMode: colorLabel(effective.colorMode),
  });

  return (
    <details className={className ?? "mt-2 rounded-lg border border-border bg-background px-2.5 py-2"}>
      <summary className="cursor-pointer text-xs font-semibold text-foreground">
        <span>{t("scanPreferences.options")}</span>
        <span className="ms-1 font-normal text-muted-foreground">{effectiveSummary}</span>
      </summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="block text-xs text-muted-foreground">
          {t("scanPreferences.source")}
          <select
            className="input-premium mt-1 h-9 w-full"
            value={overrides.source ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ ...overrides, source: event.target.value ? event.target.value as Naps2ScanSource : undefined })}
          >
            <option value="">{t("scanPreferences.useWorkstationDefault", { value: sourceLabel(workstationDefault.source) })}</option>
            <option value="auto">{t("settings.documents.autoSource")}</option>
            <option value="feeder">{t("settings.documents.feeder")}</option>
            <option value="flatbed">{t("settings.documents.flatbed")}</option>
            <option value="duplex">{t("settings.documents.duplex")}</option>
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">
          {t("scanPreferences.dpi")}
          <select
            className="input-premium mt-1 h-9 w-full"
            value={overrides.dpi == null ? "" : String(overrides.dpi)}
            disabled={disabled}
            onChange={(event) => onChange({ ...overrides, dpi: event.target.value ? Number(event.target.value) : undefined })}
          >
            <option value="">{t("scanPreferences.useWorkstationDefault", { value: `${workstationDefault.dpi} DPI` })}</option>
            {[150, 200, 300, 400, 600].map((dpi) => <option key={dpi} value={dpi}>{dpi} DPI</option>)}
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">
          {t("scanPreferences.colorMode")}
          <select
            className="input-premium mt-1 h-9 w-full"
            value={overrides.colorMode ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ ...overrides, colorMode: event.target.value ? event.target.value as "grayscale" | "color" : undefined })}
          >
            <option value="">{t("scanPreferences.useWorkstationDefault", { value: colorLabel(workstationDefault.colorMode) })}</option>
            <option value="grayscale">{t("settings.documents.grayscale")}</option>
            <option value="color">{t("settings.documents.color")}</option>
          </select>
        </label>
      </div>
    </details>
  );
}
