import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/shared/Button";
import { pushToast } from "@/lib/toast";
import QzTrayPrintingSection from "@/pages/settings/qz-tray-printing-section";

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
  return <div className="mx-auto w-full max-w-6xl space-y-4"><div><h1 className="text-2xl font-semibold">Workstation printing</h1><p className="text-sm text-muted-foreground">Configure QZ Tray and physical printer mappings for this browser only.</p></div><WorkstationSetupCard /><QzTrayPrintingSection /></div>;
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
