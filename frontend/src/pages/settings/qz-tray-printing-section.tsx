import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { pushToast } from "@/lib/toast";
import { connectQzTray, getInstalledPrinters, getPrinterDetails, isQzConnected } from "@/services/printing/qz-tray-service";
import { directTestPrint } from "@/services/printing/direct-print-service";
import { clearUnavailablePrinterTrays, createDefaultQzPrinterSettings, loadQzPrinterSettings, saveQzPrinterSettings } from "@/services/printing/workstation-printer-settings";
import type { PrinterProfile, QzPrinterDetail, QzPrinterSettings } from "@/types/printing";

const PROFILE_LABELS: Record<PrinterProfile["documentType"], string> = {
  A4_DOCUMENT: "A4 document",
  A5_DOCUMENT: "A5 document",
  ACCESSION_LABEL: "Accession label",
  RECEIPT: "Receipt",
};

export default function QzTrayPrintingSection() {
  const [settings, setSettings] = useState<QzPrinterSettings>(() => loadQzPrinterSettings());
  const [printers, setPrinters] = useState<string[]>([]);
  const [details, setDetails] = useState<QzPrinterDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState("");

  async function refreshPrinters() {
    setLoading(true);
    setConnectionError("");
    try {
      await connectQzTray();
      const [names, detailRows] = await Promise.all([getInstalledPrinters(), getPrinterDetails()]);
      setPrinters(names);
      setDetails(detailRows);
      setSettings((current) => clearUnavailablePrinterTrays(current, detailRows));
    } catch (error) {
      setPrinters([]);
      setDetails([]);
      setConnectionError(error instanceof Error ? error.message : "Unable to connect to QZ Tray.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refreshPrinters(); }, []);

  function updateProfile(documentType: PrinterProfile["documentType"], patch: Partial<PrinterProfile>) {
    setSettings((current) => ({ ...current, profiles: current.profiles.map((profile) => profile.documentType === documentType ? { ...profile, ...patch } : profile) }));
  }

  async function runTest(profile: PrinterProfile) {
    if (!profile.printerName) {
      pushToast({ type: "error", title: "Printer not configured", message: `Select a printer for ${PROFILE_LABELS[profile.documentType]} first.` });
      return;
    }
    setTesting(profile.documentType);
    try {
      const result = await directTestPrint(profile);
      if (result.success) pushToast({ type: "success", title: "Test job submitted", message: `Print job sent to ${result.printerName}.` });
      else pushToast({ type: "error", title: "Test print failed", message: result.message });
    } catch (error) {
      pushToast({ type: "error", title: "Test print failed", message: error instanceof Error ? error.message : "QZ Tray rejected the test job." });
    } finally {
      setTesting(null);
    }
  }

  const detailByName = useMemo(() => new Map(details.map((item) => [item.name, item])), [details]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold">QZ Tray direct printing</h4>
            <p className="mt-1 text-sm text-muted-foreground">Mappings are stored only in this browser for workstation <span className="font-mono text-xs">{settings.workstationId}</span>.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${isQzConnected() ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {isQzConnected() ? <CheckCircle2 size={14} /> : <Unplug size={14} />}{isQzConnected() ? "Connected" : "Disconnected"}
            </span>
            <Button type="button" size="sm" variant="secondary" onClick={() => void refreshPrinters()} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Refresh printers
            </Button>
          </div>
        </div>
        {connectionError ? <p className="mt-3 text-sm text-red-700" role="alert">{connectionError}</p> : null}
      </div>

      {settings.profiles.map((profile) => {
        const trays = detailByName.get(profile.printerName)?.trays ?? [];
        const standardPaper = profile.documentType === "A4_DOCUMENT" || profile.documentType === "A5_DOCUMENT";
        return (
          <section key={profile.documentType} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-3"><h4 className="font-semibold">{PROFILE_LABELS[profile.documentType]}</h4><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={profile.enabled} onChange={(event) => updateProfile(profile.documentType, { enabled: event.target.checked })} />Enabled</label></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Printer" wide><select className="input-premium h-10 w-full" value={profile.printerName} onChange={(event) => updateProfile(profile.documentType, { printerName: event.target.value, printerTray: undefined })}><option value="">Select printer</option>{printers.map((printer) => <option key={printer} value={printer}>{printer}</option>)}</select></Field>
              <Field label="Paper width (mm)"><input className="input-premium h-10 w-full" type="number" min="10" max="500" step="0.1" disabled={standardPaper} value={profile.paperWidthMm} onChange={(event) => updateProfile(profile.documentType, { paperWidthMm: Number(event.target.value) })} /></Field>
              <Field label="Paper height (mm)"><input className="input-premium h-10 w-full" type="number" min="10" max="1000" step="0.1" disabled={standardPaper} value={profile.paperHeightMm} onChange={(event) => updateProfile(profile.documentType, { paperHeightMm: Number(event.target.value) })} /></Field>
              <Field label="Orientation"><select className="input-premium h-10 w-full" value={profile.orientation} onChange={(event) => updateProfile(profile.documentType, { orientation: event.target.value as PrinterProfile["orientation"] })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></Field>
              <Field label="Copies"><input className="input-premium h-10 w-full" type="number" min="1" max="99" value={profile.copies} onChange={(event) => updateProfile(profile.documentType, { copies: Number(event.target.value) })} /></Field>
              <Field label="Printer tray"><select className="input-premium h-10 w-full" value={profile.printerTray || ""} onChange={(event) => updateProfile(profile.documentType, { printerTray: event.target.value || undefined })}><option value="">Printer default</option>{trays.map((tray) => <option key={tray} value={tray}>{tray}</option>)}</select></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={profile.scaleContent} onChange={(event) => updateProfile(profile.documentType, { scaleContent: event.target.checked })} />Scale content to page</label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm" title={standardPaper ? "Standard A4/A5 media is fixed." : "Required for label and receipt driver media."}><input type="checkbox" checked={profile.customPaperSize} disabled onChange={() => undefined} />Use custom printer media</label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm" title="Rasterize only when the printer driver requires it."><input type="checkbox" checked={profile.rasterize} onChange={(event) => updateProfile(profile.documentType, { rasterize: event.target.checked })} />Rasterize PDF for this driver</label>
              <div className="self-end"><Button type="button" size="sm" variant="secondary" onClick={() => void runTest(profile)} disabled={testing != null || !profile.enabled}>{testing === profile.documentType ? <Loader2 size={14} className="animate-spin" /> : null}Test print</Button></div>
            </div>
          </section>
        );
      })}

      <label className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm"><input type="checkbox" checked={settings.browserPrintFallbackEnabled} onChange={(event) => setSettings((current) => ({ ...current, browserPrintFallbackEnabled: event.target.checked }))} /><span><strong>Allow browser-print fallback</strong><span className="block text-xs text-muted-foreground">Fallback is offered as a user-selected toast action; RISpro never opens the browser print dialog automatically after a QZ failure.</span></span></label>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={() => { if (window.confirm("Reset printer settings for this workstation?")) setSettings(createDefaultQzPrinterSettings()); }}>Reset local printer settings</Button><Button type="button" onClick={() => { const saved = saveQzPrinterSettings(settings); setSettings(saved); pushToast({ type: "success", title: "Printer settings saved", message: "This workstation will use the configured QZ printer mappings." }); }}>Save settings</Button></div>
    </div>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`text-sm ${wide ? "md:col-span-2" : ""}`}><span className="mb-1 block font-medium">{label}</span>{children}</label>;
}
