import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, ErrorState, Input, LoadingState } from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";
import { ApiError } from "@/lib/api-client";
import { fetchWidgetPreview, fetchWidgetTokens, mutateWidgetToken, widgetKeys, type WidgetToken } from "./mobile-widget-api";

type Action = { kind: "create" } | { kind: "rotate" | "revoke"; token: WidgetToken };
export default function MobileWidgetAccessSection({ onReAuthRequired, reauthVersion = 0, reauthCancelVersion = 0 }: {
  onReAuthRequired: (key: string[]) => void; reauthVersion?: number; reauthCancelVersion?: number;
}) {
  const { t, language, isArabic } = useLanguage();
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: widgetKeys.tokens, queryFn: fetchWidgetTokens });
  const preview = useQuery({ queryKey: widgetKeys.preview, queryFn: fetchWidgetPreview, refetchInterval: 60_000 });
  const [action, setAction] = useState<Action | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [days, setDays] = useState(180);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const pending = useRef<(() => Promise<void>) | null>(null);
  const mounted = useRef(true);
  const observedVersion = useRef(reauthVersion);
  const observedCancelVersion = useRef(reauthCancelVersion);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current = null; }; }, []);
  useEffect(() => {
    if (observedVersion.current === reauthVersion) return;
    observedVersion.current = reauthVersion;
    const resume = pending.current; pending.current = null;
    if (resume) void resume();
  }, [reauthVersion]);
  useEffect(() => {
    if (observedCancelVersion.current === reauthCancelVersion) return;
    observedCancelVersion.current = reauthCancelVersion;
    pending.current = null;
  }, [reauthCancelVersion]);
  function close() { if (busy) return; pending.current = null; setAction(null); setSecret(null); setError(false); setCopied(false); }
  function open(next: Action) { setError(false); setAction(next); setDeviceName(""); setDays(180); }
  async function submit(selected: Action) {
    setBusy(true); setError(false);
    try {
      const path = selected.kind === "create" ? "" : `/${selected.token.id}/${selected.kind}`;
      const result = await mutateWidgetToken(path, { deviceName, expiresAt: new Date(Date.now() + days * 86400_000).toISOString() });
      if (!mounted.current) return;
      setAction(null); setSecret(result.secret ?? null); setCopied(false);
      await queryClient.invalidateQueries({ queryKey: widgetKeys.tokens });
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.status === 403 && cause.message.includes("re-authentication")) {
        pending.current = () => submit(selected); onReAuthRequired(widgetKeys.tokens);
      } else setError(true);
    } finally { if (mounted.current) setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setError(true); }
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleString(language === "ar" ? "ar-LY" : "en-GB", { timeZone: "Africa/Tripoli", dateStyle: "medium", timeStyle: "short" }) : t("mobileWidget.never");
  const data = preview.data;
  return <div className="min-w-0 space-y-5" dir={isArabic ? "rtl" : "ltr"}>
    <p className="text-sm text-muted-foreground">{t("mobileWidget.description")}</p>
    <Card className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{t("mobileWidget.preview")}</h3><Button variant="secondary" size="sm" onClick={() => void preview.refetch()} disabled={preview.isFetching}>{t("common.refreshNow")}</Button></div>
      {preview.isPending && <LoadingState message={t("common.loading")} />}
      {preview.isError && <ErrorState message={t(data ? "mobileWidget.stale" : "mobileWidget.previewError")} onRetry={() => void preview.refetch()} />}
      {data && <>
        <p className="text-xs text-muted-foreground">{t("mobileWidget.updated", { date: data.date, time: date(data.generatedAt) })}</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([
          ["mobileWidget.today", data.totals.totalAppointments], ["mobileWidget.waiting", data.totals.waiting],
          ["mobileWidget.scanning", data.totals.inProgress], ["mobileWidget.completed", data.totals.completed],
        ] as const).map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{t(label)}</dt><dd className="text-2xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
        <p className="text-sm">{t("mobileWidget.oldest", { minutes: data.waiting.oldestWaitingMinutes ?? t("common.na") })}</p>
        <div className="flex flex-wrap gap-2">{data.modalities.map(modality => <Badge key={modality.modalityId} variant="neutral">{t("mobileWidget.modalitySummary", { code: modality.code, total: modality.totalAppointments, waiting: modality.waiting, scanning: modality.inProgress })}</Badge>)}</div>
      </>}
    </Card>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{t("mobileWidget.devices")}</h3><Button onClick={() => open({ kind: "create" })}>{t("mobileWidget.create")}</Button></div>
    {tokens.isPending && <LoadingState message={t("common.loading")} />}
    {tokens.isError && <ErrorState message={t("mobileWidget.loadError")} onRetry={() => void tokens.refetch()} />}
    {tokens.data?.tokens.length === 0 && <EmptyState message={t("mobileWidget.empty")} />}
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">{tokens.data?.tokens.map(token => <Card key={token.id} variant="compact" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">{token.deviceName}</h4><Badge variant={token.status === "active" ? "success" : token.status === "expired" ? "warning" : "neutral"}>{t(`mobileWidget.${token.status}`)}</Badge></div>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("mobileWidget.prefix")}</dt><dd dir="ltr" className="break-all text-start font-mono">{token.tokenPrefix}…</dd>
        <dt className="text-muted-foreground">{t("mobileWidget.created")}</dt><dd>{date(token.createdAt)}</dd>
        <dt className="text-muted-foreground">{t("mobileWidget.expires")}</dt><dd>{date(token.expiresAt)}</dd>
        <dt className="text-muted-foreground">{t("mobileWidget.lastUsed")}</dt><dd>{date(token.lastUsedAt)}</dd>
        <dt className="text-muted-foreground">{t("mobileWidget.creator")}</dt><dd className="break-words [overflow-wrap:anywhere]">{token.createdByName}</dd>
      </dl>
      {token.status !== "revoked" && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => open({ kind: "rotate", token })}>{t("mobileWidget.rotate")}</Button><Button variant="secondary" onClick={() => open({ kind: "revoke", token })}>{t("mobileWidget.revoke")}</Button></div>}
    </Card>)}</div>
    <details className="text-sm"><summary className="cursor-pointer font-medium">{t("mobileWidget.setup")}</summary><p className="mt-2 whitespace-pre-line">{t("mobileWidget.instructions")}</p></details>
    <Dialog open={action !== null || secret !== null} onClose={close}><DialogContent maxWidth="520px" aria-labelledby="mobile-widget-dialog-title">
      <div className="min-w-0 space-y-4" dir={isArabic ? "rtl" : "ltr"}>
        <h3 id="mobile-widget-dialog-title" className="text-lg font-semibold">{t(secret ? "mobileWidget.reveal" : action?.kind === "rotate" ? "mobileWidget.rotate" : action?.kind === "revoke" ? "mobileWidget.revoke" : "mobileWidget.create")}</h3>
        {error && <p role="alert" className="text-sm">{t("mobileWidget.actionError")}</p>}
        {secret ? <>
          <p className="text-sm">{t("mobileWidget.once")}</p>
          <code data-testid="mobile-widget-secret" dir="ltr" className="block select-all whitespace-normal break-all rounded border p-3 text-sm">{secret}</code>
          <div className="flex flex-wrap gap-2"><Button onClick={() => void copy(secret)}>{t("mobileWidget.copy")}</Button><Button variant="secondary" onClick={() => void copy(t("mobileWidget.instructions"))}>{t("mobileWidget.copySetup")}</Button><Button variant="secondary" onClick={close}>{t("mobileWidget.done")}</Button></div>
          {copied && <p role="status">{t("mobileWidget.copied")}</p>}
        </> : action && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(action); }}>
          {action.kind === "create" ? <label className="block space-y-1"><span>{t("mobileWidget.deviceName")}</span><Input required maxLength={100} value={deviceName} onChange={event => setDeviceName(event.target.value)} className="w-full" autoComplete="off" /></label> : <p className="break-words text-sm [overflow-wrap:anywhere]">{t(action.kind === "rotate" ? "mobileWidget.rotateConfirm" : "mobileWidget.revokeConfirm", { device: action.token.deviceName })}</p>}
          {action.kind !== "revoke" && <label className="block space-y-1"><span>{t("mobileWidget.expiry")}</span><select className="input-premium w-full" value={days} onChange={event => setDays(Number(event.target.value))}>{[30, 90, 180, 365].map(value => <option key={value} value={value}>{t("mobileWidget.days", { days: value })}</option>)}</select></label>}
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{t(busy ? "common.loading" : "common.continue")}</Button><Button type="button" variant="secondary" disabled={busy} onClick={close}>{t("common.cancel")}</Button></div>
        </form>}
      </div>
    </DialogContent></Dialog>
  </div>;
}
