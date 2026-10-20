import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/shared/Input";
import type { IntegrationStatus } from "@/lib/api/documents-printing";
import { Button } from "@/components/shared/Button";
import { pushToast } from "@/lib/toast";
import { fetchIntegrationStatus } from "@/lib/api-hooks";
import { getNaps2WebScanStatus, scanAppointmentRequest, type Naps2WebScanStatus } from "@/lib/naps2-webscan";
import QzTrayPrintingSection from "@/pages/settings/qz-tray-printing-section";
import {
  loadWorkstationNaps2Settings,
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

export function WorkstationNaps2Section() {
  const [endpointInput, setEndpointInput] = useState(() => loadWorkstationNaps2Settings()?.endpoint || "");
  const [scanner, setScanner] = useState<IntegrationStatus["scanner"] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [testing, setTesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [connection, setConnection] = useState<Naps2WebScanStatus | null>(null);
  const [scanMessage, setScanMessage] = useState("No test scan completed.");
  const [, setSettingsRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchIntegrationStatus().then((status) => {
      if (active) setScanner(status.scanner);
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : "Unable to load scanner configuration.");
    });
    return () => { active = false; };
  }, []);

  let effective: ReturnType<typeof resolveEffectiveNaps2Endpoint> = { endpoint: undefined, source: "localhost" };
  let endpointError = "";
  try { effective = resolveEffectiveNaps2Endpoint(scanner?.naps2WebScanEndpoint); }
  catch (error) { endpointError = error instanceof Error ? error.message : "Invalid system scanner endpoint."; }
  const enabled = scanner?.naps2WebScanEnabled === true;
  const sourceLabel = effective.source === "workstation" ? "Workstation override" : effective.source === "system" ? "System default" : "Automatic localhost discovery";

  async function downloadSetup() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const url = effective.source === "workstation" ? `/api/scanner-bootstrap/windows-setup?endpoint=${encodeURIComponent(effective.endpoint!)}` : "/api/scanner-bootstrap/windows-setup";
      const response = await fetch(url, { cache: "no-store", redirect: "error" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || `NAPS2 setup download failed (HTTP ${response.status}).`);
      }
      const script = await response.text();
      if (response.headers.get("Content-Type")?.split(";", 1)[0].trim() !== "application/octet-stream" || !script.startsWith("@echo off\r\n") || !script.includes("\r\n# RISPRO_NAPS2_POWERSHELL\r\n")) {
        throw new Error("RISpro returned an invalid NAPS2 setup file. Ask an administrator to check the scanner setup configuration, then retry.");
      }
      const blobUrl = URL.createObjectURL(new Blob([script], { type: "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "RISpro-NAPS2-Setup.cmd";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Unable to download NAPS2 setup. Retry or contact an administrator.");
    } finally { setDownloading(false); }
  }

  function clearResult() { setConnection(null); setScanMessage("No test scan completed."); }
  function saveEndpoint() {
    try {
      const saved = saveWorkstationNaps2Settings(endpointInput);
      setEndpointInput(saved.endpoint);
      setSettingsRevision((current) => current + 1);
      clearResult();
      pushToast({ type: "success", title: "NAPS2 endpoint saved", message: "Test the connection to verify this browser can access the scanner." });
    } catch (error) {
      pushToast({ type: "error", title: "Invalid NAPS2 endpoint", message: error instanceof Error ? error.message : "Enter a valid scanner origin." });
    }
  }
  async function test(scan: boolean) {
    if (testing || !scanner || endpointError) return;
    setTesting(true);
    try {
      // Resolve saved settings at click time, including immediately after a reset.
      const endpoint = resolveEffectiveNaps2Endpoint(scanner.naps2WebScanEndpoint).endpoint;
      const status = await getNaps2WebScanStatus(endpoint, scanner.naps2WebScanAllowedOrigins);
      setConnection(status);
      if (!status.available) throw new Error(status.message);
      if (scan) {
        setScanMessage("Scanning test paper…");
        const result = await scanAppointmentRequest({ endpoint: status.endpoint, allowedOrigins: scanner.naps2WebScanAllowedOrigins, dpi: Number(scanner.scanDpi || 200), colorMode: scanner.scanColorMode === "color" ? "color" : "grayscale", source: scanner.scannerSource === "flatbed" ? "flatbed" : scanner.scannerSource === "duplex" ? "duplex" : "feeder", fileName: "naps2-test-scan.pdf" });
        setScanMessage(`Test scan succeeded: ${result.pageCount} page(s). No patient document was uploaded or linked.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to access NAPS2 Scanner Sharing.";
      if (scan) setScanMessage(`Test scan failed: ${message}`);
      else setConnection({ available: false, message });
      pushToast({ type: "error", title: scan ? "NAPS2 test scan failed" : "NAPS2 connection failed", message });
    } finally { setTesting(false); }
  }
  function resetEndpoint() {
    resetWorkstationNaps2Settings();
    setEndpointInput("");
    setSettingsRevision((current) => current + 1);
    clearResult();
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="workstation-naps2-title">
      <h2 id="workstation-naps2-title" className="font-semibold">Workstation NAPS2 scanner</h2>
      <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-muted-foreground">
        <li>Install official NAPS2, select the scanner, enable Scanner Sharing and its background-sharing option.</li>
        <li>Download the setup and run it as administrator on this Windows workstation. Follow any action reported in its log.</li>
      </ol>
      <div className="mt-3"><Button type="button" onClick={() => void downloadSetup()} disabled={downloading || Boolean(endpointError)}>{downloading ? "Downloading NAPS2 setup…" : "Download NAPS2 setup"}</Button></div>
      {downloadError ? <p className="mt-3 text-sm text-destructive" role="alert">{downloadError}</p> : null}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <StatusItem label="Global scanning" value={scanner ? enabled ? "Enabled" : "Disabled in Documents & Uploads" : "Configuration unavailable"} />
        <StatusItem label="Scanner connection status" value={connection ? connection.available ? "Connected — capabilities verified" : "Action required" : "Not tested on this workstation"} />
        <StatusItem label="Effective scanner endpoint" value={effective.endpoint || connection?.endpoint || "Automatic HTTP loopback discovery, ports 9801–9850"} mono />
        <StatusItem label="Endpoint source" value={sourceLabel} />
      </dl>
      {loadError || endpointError ? <p className="mt-3 text-sm text-destructive" role="alert">{loadError || endpointError}</p> : null}
      {connection?.message ? <p className="mt-3 text-sm" role="status">{connection.message}</p> : null}
      <p className="mt-3 text-sm" role="status">{scanMessage}</p>
      <p className="mt-2 text-xs text-muted-foreground">Test connection reads scanner capabilities without moving paper. Test scan physically scans the selected feeder/flatbed; use test paper. It does not attach anything to a patient. Patient attachment is confirmed separately after upload. Manual PDF/image upload remains available.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void test(false)} disabled={testing || !scanner || Boolean(endpointError)}>Test connection</Button>
        <Button type="button" onClick={() => void test(true)} disabled={testing || !enabled || Boolean(endpointError)}>Test scan</Button>
      </div>
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-sm font-semibold">Advanced endpoint override</summary>
        <label className="mt-3 block text-sm font-medium" htmlFor="workstation-naps2-endpoint">NAPS2 eSCL endpoint</label>
        <Input id="workstation-naps2-endpoint" className="mt-1 h-10 w-full" type="url" value={endpointInput} placeholder="http://scanner-host-IP:9801" onChange={(event) => setEndpointInput(event.target.value)} />
        <p className="mt-2 text-xs text-muted-foreground">Save before testing. An explicit remote endpoint remains authoritative and must be approved in the server CSP. Reset restores the system endpoint or automatic local discovery.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={resetEndpoint} disabled={testing}>Reset to system default</Button>
          <Button type="button" onClick={saveEndpoint} disabled={testing}>Save workstation endpoint</Button>
        </div>
      </details>
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
