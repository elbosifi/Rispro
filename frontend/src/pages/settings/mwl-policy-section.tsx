import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/shared/Button";
import { Switch } from "@/components/shared/Switch";
import { fetchSettings, saveSettings } from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";

const CATEGORY = "mwl_policy";
const KEY = "require_protocol_before_mwl_for_protocoling_modalities";
const isReauthError = (error: unknown) => /re-?authentication|reauth|403/i.test(error instanceof Error ? error.message : String(error || ""));

export default function MwlPolicySection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["settings", CATEGORY],
    queryFn: () => fetchSettings(CATEGORY),
  });
  const serverEnabled = String(settingsQuery.data?.[KEY] ?? "disabled").toLowerCase() === "enabled";
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const enabled = enabledOverride ?? serverEnabled;
  const [message, setMessage] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: () => saveSettings(CATEGORY, {
      entries: [{ key: KEY, value: { value: enabled ? "enabled" : "disabled" } }],
    }),
    onSuccess: async () => {
      setEnabledOverride(null);
      setMessage(t("settings.mwlPolicy.saved"));
      await queryClient.invalidateQueries({ queryKey: ["settings", CATEGORY] });
      await queryClient.invalidateQueries({ queryKey: ["dicom", "worklist-monitor"] });
    },
    onError: (error: unknown) => {
      if (isReauthError(error)) onReAuthRequired(["settings", CATEGORY]);
      setMessage(error instanceof Error ? error.message : t("settings.mwlPolicy.saveFailed"));
    },
  });

  if (settingsQuery.error) {
    const messageText = (settingsQuery.error as Error).message;
    if (messageText.includes("re-authentication") || messageText.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", CATEGORY])} />;
    }
    return <QueryError message={messageText} />;
  }
  if (settingsQuery.isLoading) return <p className="description-center">{t("settings.loading")}</p>;

  return (
    <div className="space-y-4" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex items-start justify-between gap-4">
          <label htmlFor="require-protocol-before-mwl" className="min-w-0 flex-1">
            <strong className="block text-sm text-foreground">{t("settings.mwlPolicy.requireProtocol")}</strong>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {t("settings.mwlPolicy.requireProtocolHelp")}
            </span>
          </label>
          <Switch
            id="require-protocol-before-mwl"
            aria-label={t("settings.mwlPolicy.requireProtocol")}
            checked={enabled}
            onChange={(event) => setEnabledOverride(event.target.checked)}
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || enabled === serverEnabled}>
          {saveMutation.isPending ? t("common.loading") : t("settings.save")}
        </Button>
        {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
      </div>
    </div>
  );
}
