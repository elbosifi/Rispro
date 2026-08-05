import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/shared/Button";
import { pushToast } from "@/lib/toast";
import { fetchIntegrationStatus } from "@/lib/api-hooks";
import { getNaps2WebScanStatus } from "@/lib/naps2-webscan";
import QzTrayPrintingSection from "@/pages/settings/qz-tray-printing-section";
import {
  loadWorkstationNaps2Settings,
  normalizeNaps2Origin,
  resetWorkstationNaps2Settings,
  resolveEffectiveNaps2Endpoint,
  saveWorkstationNaps2Settings,
} from "@/services/scanning/workstation-naps2-settings";

const MANIFEST_URL = "/api/public/printing-bootstrap/manifest";
const SETUP_LOG_PATH = String.raw`%ProgramData%\RISpro\PrintingSetup\setup.log`;
type BootstrapManifest = {
  ready: boolean;
  reason?: string;
  risproOrigin?: string;
  qzVersion?: string;
  qzInstallerArchitecture?: string;
  signingCertificateFingerprint?: string;
  securePorts?: number[];
  windowsLauncherUrl?: string;
  windowsScriptUrl?: string;
  qzInstallerUrl?: string;
  rootCertificateUrl?: string;
  signingCertificateUrl?: string;
  windowsScriptSha256?: string;
  qzInstallerSha256?: string;
};

export default function WorkstationPrintingPage() {
  return <div className="mx-auto w-full max-w-6xl space-y-4"><div><h1 className="text-2xl font-semibold">Workstation printing and scanning</h1><p className="text-sm text-muted-foreground">Configure QZ Tray, physical printer mappings, and the NAPS2 scanner endpoint for this browser only.</p></div><WorkstationSetupCard /><QzTrayPrintingSection /><WorkstationNaps2Section /></div>;
}

function WorkstationNaps2Section() {
  const [endpointInput, setEndpointInput] = useState(() => loadWorkstationNaps2Settings()?.endpoint || "");
  const [globalEndpoint, setGlobalEndpoint] = useState("");
  const [testing, setTesting] = useState(false);
  const [, setSettingsRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchIntegrationStatus().then((status) => {
      if (active) setGlobalEndpoint(status?.scanner?.naps2WebScanEndpoint || "");
    }).catch(() => {
      if (active) setGlobalEndpoint("");
    });
    return () => { active = false; };
  }, []);

  const effective = resolveEffectiveNaps2Endpoint(globalEndpoint);
  const sourceLabel = effective.source === "workstation"
    ? "Workstation override"
    : effective.source === "system"
      ? "System default"
      : "Automatic localhost probe";
  const effectiveLabel = effective.endpoint || "http://127.0.0.1:9801, then http://localhost:9801";

  function saveEndpoint() {
    try {
      const saved = saveWorkstationNaps2Settings(endpointInput);
      setEndpointInput(saved.endpoint);
      setSettingsRevision((current) => current + 1);
      pushToast({ type: "success", title: "NAPS2 endpoint saved", message: "This browser will use the workstation scanner origin." });
    } catch (error) {
      pushToast({ type: "error", title: "Invalid NAPS2 endpoint", message: error instanceof Error ? error.message : "Enter a valid NAPS2 HTTP or HTTPS origin." });
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const endpoint = normalizeNaps2Origin(endpointInput);
      const status = await getNaps2WebScanStatus(endpoint);
      if (!status.available) throw new Error(status.message || "NAPS2 Scanner Sharing is not available on this workstation.");
      pushToast({ type: "success", title: "NAPS2 connection available", message: `Connected to ${status.endpoint || endpoint}.` });
    } catch (error) {
      pushToast({ type: "error", title: "NAPS2 connection failed", message: error instanceof Error ? error.message : "Unable to connect to NAPS2 Scanner Sharing." });
    } finally {
      setTesting(false);
    }
  }

  function resetEndpoint() {
    resetWorkstationNaps2Settings();
    setEndpointInput("");
    setSettingsRevision((current) => current + 1);
    pushToast({ type: "success", title: "NAPS2 endpoint reset", message: "This browser will use the system scanner endpoint." });
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="workstation-naps2-title">
      <div>
        <h2 id="workstation-naps2-title" className="font-semibold">Workstation NAPS2 scanner</h2>
        <p className="mt-1 text-sm text-muted-foreground">Override only the NAPS2 eSCL origin used by this browser. Scanning must remain enabled in Documents &amp; Uploads.</p>
      </div>
      <label className="mt-4 block text-sm font-medium" htmlFor="workstation-naps2-endpoint">NAPS2 eSCL endpoint</label>
      <input id="workstation-naps2-endpoint" className="input-premium mt-1 h-10 w-full" type="url" value={endpointInput} placeholder="http://scanner-workstation:9801" onChange={(event) => setEndpointInput(event.target.value)} />
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <StatusItem label="Effective endpoint" value={effectiveLabel} mono />
        <StatusItem label="Endpoint source" value={sourceLabel} />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">Remote origins must be deployment-approved in CSP and may also require HTTPS certificate trust, CORS, Local Network Access permission, and firewall access.</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={resetEndpoint}>Reset to system default</Button>
        <Button type="button" variant="secondary" onClick={() => void testConnection()} disabled={testing}>{testing ? "Testing…" : "Test connection"}</Button>
        <Button type="button" onClick={saveEndpoint}>Save workstation endpoint</Button>
      </div>
    </section>
  );
}

function WorkstationSetupCard() {
  const [manifest, setManifest] = useState<BootstrapManifest | null>(null);
  const [loading, setLoading] = useState(true);

  const loadManifest = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Bootstrap manifest request failed (${response.status}).`);
      setManifest(await response.json() as BootstrapManifest);
    } catch (error) {
      setManifest({ ready: false, reason: error instanceof Error ? error.message : "Printing bootstrap is unavailable." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadManifest(); }, [loadManifest]);

  async function copyValue(label: string, value: string | undefined) {
    try {
      if (!value || !navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(value);
      pushToast({ type: "success", title: "Copied", message: `${label} copied to the clipboard.` });
    } catch (error) {
      pushToast({ type: "error", title: "Copy failed", message: error instanceof Error ? error.message : `Unable to copy ${label}.` });
    }
  }

  const ready = manifest?.ready === true;
  const ports = manifest?.securePorts?.join(", ") || "Unavailable";

  return (
    <div className="space-y-2">
      <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="workstation-setup-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="workstation-setup-title" className="font-semibold">Workstation setup and diagnostics</h2>
            <p className="mt-1 text-sm text-muted-foreground">Install the approved RISpro printing components or inspect workstation setup details.</p>
          </div>
          <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Bootstrap status:</span><strong>{loading ? "Loading…" : ready ? "Ready" : "Unavailable"}</strong><Button type="button" size="sm" variant="secondary" onClick={() => void loadManifest()} disabled={loading}>Retry</Button></div>
        </div>

        {!loading && !ready ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{manifest?.reason || "Printing bootstrap is unavailable."}</p> : null}

        <dl className="mt-3 grid gap-x-5 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <StatusItem label="Official RISpro origin" value={manifest?.risproOrigin} />
          <StatusItem label="QZ Tray version" value={manifest?.qzVersion} />
          <StatusItem label="Installer architecture" value={manifest?.qzInstallerArchitecture} />
          <StatusItem label="Signing certificate fingerprint" value={manifest?.signingCertificateFingerprint} mono />
          <StatusItem label="Secure ports" value={ports} />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <DownloadLink href={ready ? manifest?.windowsLauncherUrl : undefined} filename="RISpro-Printing-Setup.cmd" primary>Download and install RISpro Printing</DownloadLink>
          <p className="max-w-xl text-xs text-muted-foreground">Recommended. Installs or repairs QZ Tray and configures RISpro trust on this Windows workstation.</p>
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-sm font-semibold">Other downloads</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <DownloadLink href={ready ? manifest?.windowsScriptUrl : undefined}>PowerShell setup script</DownloadLink>
            <DownloadLink href={ready ? manifest?.qzInstallerUrl : undefined}>QZ Tray 2.2.6 installer</DownloadLink>
            <DownloadLink href={ready ? manifest?.rootCertificateUrl : undefined}>RISpro root certificate</DownloadLink>
            <DownloadLink href={ready ? manifest?.signingCertificateUrl : undefined}>RISpro signing certificate</DownloadLink>
          </div>
        </div>

        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-semibold">Advanced diagnostics</summary>
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <a href={MANIFEST_URL} target="_blank" rel="noreferrer" className="btn-secondary inline-flex h-[var(--control-height-sm)] items-center px-3 text-sm">View bootstrap manifest</a>
              <CopyButton label="manifest URL" value={MANIFEST_URL} onCopy={copyValue}>Copy manifest URL</CopyButton>
              <CopyButton label="official RISpro origin" value={manifest?.risproOrigin} onCopy={copyValue}>Copy official RISpro origin</CopyButton>
              <CopyButton label="signing certificate fingerprint" value={manifest?.signingCertificateFingerprint} onCopy={copyValue}>Copy signing certificate fingerprint</CopyButton>
              <CopyButton label="setup log path" value={SETUP_LOG_PATH} onCopy={copyValue}>Copy setup log path</CopyButton>
            </div>
            <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
              <StatusItem label="Expected secure QZ ports" value={ports} />
              <StatusItem label="PowerShell script SHA-256" value={manifest?.windowsScriptSha256} mono />
              <StatusItem label="QZ installer SHA-256" value={manifest?.qzInstallerSha256} mono />
            </dl>
          </div>
        </details>
      </section>
    </div>
  );
}

function StatusItem({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`${mono ? "font-mono text-xs" : ""} break-all`}>{value || "Unavailable"}</dd></div>;
}

function DownloadLink({ href, filename, primary = false, children }: { href?: string; filename?: string; primary?: boolean; children: React.ReactNode }) {
  const classes = `${primary ? "btn-primary" : "btn-secondary"} inline-flex h-[var(--control-height-sm)] items-center px-3 text-sm`;
  if (!href) return <span className={`${classes} cursor-not-allowed opacity-50`} aria-disabled="true">{children}</span>;
  return <a className={classes} href={href} {...(filename ? { download: filename } : {})}>{children}</a>;
}

function CopyButton({ label, value, onCopy, children }: { label: string; value?: string; onCopy: (label: string, value: string | undefined) => Promise<void>; children: React.ReactNode }) {
  return <Button type="button" size="sm" variant="secondary" onClick={() => void onCopy(label, value)}>{children}</Button>;
}
