import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { fetchDeploymentIdentitySettings, saveDeploymentIdentitySettings } from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";

function browserOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export default function DeploymentIdentitySection({ onReAuthRequired, reauthVersion }: { onReAuthRequired: (key: string[]) => void; reauthVersion: number }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pendingSaveAfterReAuth, setPendingSaveAfterReAuth] = useState<number | null>(null);
  const currentOrigin = useMemo(browserOrigin, []);
  const query = useQuery({ queryKey: ["deployment-identity"], queryFn: fetchDeploymentIdentitySettings, retry: false });

  useEffect(() => { if (query.data) setDraft(query.data.publicAppBaseUrl); }, [query.data]);
  useEffect(() => {
    if (query.error instanceof ApiError && (query.error.status === 401 || query.error.status === 403)) onReAuthRequired(["deployment-identity"]);
  }, [query.error, onReAuthRequired]);

  const mutation = useMutation({
    mutationFn: () => saveDeploymentIdentitySettings(draft),
    onSuccess: async (saved) => {
      setDraft(saved.publicAppBaseUrl);
      setPendingSaveAfterReAuth(null);
      await queryClient.invalidateQueries({ queryKey: ["deployment-identity"] });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setPendingSaveAfterReAuth(reauthVersion);
        onReAuthRequired(["deployment-identity"]);
      }
    },
  });
  useEffect(() => {
    if (pendingSaveAfterReAuth != null && reauthVersion > pendingSaveAfterReAuth && !mutation.isPending) mutation.mutate();
  }, [pendingSaveAfterReAuth, reauthVersion, mutation]);

  const isArabic = language === "ar";
  const text = isArabic
    ? { label: "عنوان RISpro العام", help: "هذا هو العنوان الرسمي المستخدم في روابط RISpro العامة.", current: "عنوان المتصفح الحالي", use: "استخدام عنوان المتصفح الحالي", save: "حفظ", loading: "جارٍ التحميل...", saved: "تم الحفظ." }
    : { label: "Public RISpro URL", help: "This is the canonical RISpro address used for public links.", current: "Current browser address", use: "Use current browser address", save: "Save", loading: "Loading...", saved: "Saved." };
  const reauthError = mutation.error instanceof ApiError && (mutation.error.status === 401 || mutation.error.status === 403);

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">{text.help}</p>
      {query.isLoading ? <p className="text-sm text-muted-foreground">{text.loading}</p> : null}
      {query.error && !(query.error instanceof ApiError && (query.error.status === 401 || query.error.status === 403)) ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{query.error instanceof Error ? query.error.message : "Could not load the setting."}</p> : null}
      <div>
        <label htmlFor="public-rispro-url" className="block text-sm font-semibold text-foreground">{text.label}</label>
        <input id="public-rispro-url" type="url" dir="ltr" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="https://rispro.nccb.com.ly" className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
      </div>
      <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
        <p className="font-semibold text-foreground">{text.current}</p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{currentOrigin || "Unavailable"}</p>
        <button type="button" onClick={() => setDraft(currentOrigin)} disabled={!currentOrigin} className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold disabled:opacity-60">{text.use}</button>
      </div>
      <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || !draft.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{text.save}
      </button>
      {mutation.isSuccess ? <p className="text-sm text-emerald-700">{text.saved}</p> : null}
      {mutation.error && !reauthError ? <p className="text-sm text-rose-700">{mutation.error instanceof Error ? mutation.error.message : "Could not save the setting."}</p> : null}
    </div>
  );
}
