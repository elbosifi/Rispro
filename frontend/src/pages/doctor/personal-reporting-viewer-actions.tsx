import { useEffect, useState } from "react";
import { ExternalLink, Monitor } from "lucide-react";

import { fetchOhifRetrievalJob, launchReportingBoardCaseInOhif } from "@/lib/api-hooks";
import type { OhifViewerAvailability, ReportingBoardMobileCase } from "@/types/api";
import { Button } from "@/components/shared";
import { buildRadiantPacsTagUrl, isWindowsWorkstation } from "./doctor-reporting-board-page.helpers";

type ViewerState = "idle" | "resolving" | "retrieving" | "failed";

function useIsMobileViewport(): boolean {
  const matchesMobile = () => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 767px)").matches;
  const [isMobile, setIsMobile] = useState(matchesMobile);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  return isMobile;
}

function actionClasses(isMobile: boolean): string {
  return isMobile
    ? "btn-secondary inline-flex h-[var(--control-height-sm)] items-center gap-1.5 px-2.5 text-sm"
    : "btn-secondary inline-flex h-9 items-center gap-1.5 px-2.5 text-sm";
}

function actionText(_isMobile: boolean, label: string) {
  return <span>{label}</span>;
}

function retrievalErrorMessage(status: string, message: string): string {
  if (message.trim()) return message;
  return status === "timed_out" ? "The study retrieval timed out." : "The OHIF study retrieval failed.";
}

export function PersonalReportingViewerActions({
  row,
  authorized,
  ohifAvailability,
}: {
  row: ReportingBoardMobileCase;
  authorized: boolean;
  ohifAvailability?: OhifViewerAvailability | null;
}) {
  const isMobile = useIsMobileViewport();
  const [viewerState, setViewerState] = useState<ViewerState>("idle");
  const [viewerMessage, setViewerMessage] = useState("");
  const accessionNumber = row.accessionNumber.trim();
  const showOhif = authorized
    && row.caseType === "appointment"
    && Boolean(accessionNumber)
    && Boolean(ohifAvailability?.enabled && ohifAvailability.configured);
  const showSonicDicom = authorized && row.caseType === "appointment" && Boolean(accessionNumber);
  const showRadiant = authorized && !isMobile && isWindowsWorkstation() && Boolean(accessionNumber);
  const isResolving = viewerState === "resolving" || viewerState === "retrieving";

  const openOhif = async () => {
    if (!showOhif || isResolving) return;

    const placeholder = window.open("about:blank", "_blank");
    if (placeholder) placeholder.opener = null;
    if (!placeholder) {
      setViewerState("failed");
      setViewerMessage("The browser blocked the OHIF tab. Allow popups for RISpro and try again.");
      return;
    }

    setViewerState("resolving");
    setViewerMessage("Resolving the current study…");
    try {
      let result = await launchReportingBoardCaseInOhif(row.appointmentId, true);
      while (result.status === "retrieving" && result.retrievalJobId) {
        setViewerState("retrieving");
        setViewerMessage(result.message);
        let ready = false;
        for (let attempt = 0; attempt < 150; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
          const job = await fetchOhifRetrievalJob(result.retrievalJobId);
          if (job.status === "ready") {
            ready = true;
            break;
          }
          if (["retrieval_failed", "failed", "timed_out", "not_found", "ambiguous"].includes(job.status)) {
            throw new Error(retrievalErrorMessage(job.status, job.message));
          }
        }
        if (!ready) throw new Error("The study retrieval timed out.");
        result = await launchReportingBoardCaseInOhif(row.appointmentId, true);
      }
      if (result.status !== "ready") throw new Error(result.message);
      placeholder.location.href = result.launchUrl;
      setViewerState("idle");
      setViewerMessage(result.priorStudyCount > 0 ? `Opening current study with ${result.priorStudyCount} prior(s).` : "Opening current study.");
    } catch (error) {
      placeholder.close();
      setViewerState("failed");
      setViewerMessage(error instanceof Error ? error.message : "The OHIF launch failed.");
    }
  };

  if (!authorized || row.caseType !== "appointment" || (!showSonicDicom && !showOhif && !showRadiant)) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="personal-reporting-viewer-actions">
      {showSonicDicom ? (
        <a
          href={`/api/doctor/reporting-board/cases/${row.appointmentId}/open-sonicdicom?scope=study`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in SonicDICOM"
          title="Open in SonicDICOM"
          className={actionClasses(isMobile)}
        >
          <ExternalLink size={15} aria-hidden="true" />
          {actionText(isMobile, "SonicDICOM")}
        </a>
      ) : null}
      {showOhif ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label="Open in OHIF"
          title={isResolving ? viewerMessage : "Open in OHIF"}
          disabled={isResolving}
          onClick={() => void openOhif()}
        >
          <ExternalLink size={15} aria-hidden="true" />
          {actionText(isMobile, viewerState === "resolving" ? "Resolving…" : viewerState === "retrieving" ? "Retrieving…" : "OHIF")}
        </Button>
      ) : null}
      {showRadiant ? (
        <a
          href={buildRadiantPacsTagUrl("00080050", accessionNumber)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in RadiAnt"
          title="Open in RadiAnt"
          className={actionClasses(isMobile)}
        >
          <Monitor size={15} aria-hidden="true" />
          {actionText(isMobile, "RadiAnt")}
        </a>
      ) : null}
      {viewerMessage ? (
        <p role={viewerState === "failed" ? "alert" : "status"} className={`basis-full text-xs ${viewerState === "failed" ? "text-red-700" : "text-slate-600"}`}>
          {viewerMessage}
        </p>
      ) : null}
    </div>
  );
}
