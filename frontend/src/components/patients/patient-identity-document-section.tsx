import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { Button, Checkbox } from "@/components/shared";
import { formatDateTimeLy } from "@/lib/date-format";
import { t } from "@/lib/i18n";
import { pushToast } from "@/lib/toast";
import { patientDirectorySummaryQueryKey } from "@/components/patients/patient-summary-formatters";
import { fetchIntegrationStatus } from "@/lib/api-hooks";
import { scanAppointmentRequest } from "@/lib/naps2-webscan";
import { resolveEffectiveNaps2Endpoint } from "@/services/scanning/workstation-naps2-settings";
import {
  fetchPatientIdentityDocument,
  uploadPatientIdentityDocument,
  verifyPatientIdentityDocument,
  revokePatientIdentityDocument,
} from "@/lib/api/patient-identity-documents";
import { PatientIdentityBadge } from "@/components/patients/patient-identity-badge";

const IDENTITY_DOCUMENT_ROLES = ["receptionist", "supervisor", "super_admin"] as const;

export function PatientIdentityDocumentSection({
  patientId,
}: {
  patientId: number;
}) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const patientIdRef = useRef<number | null>(patientId);
  patientIdRef.current = patientId;
  const scanRequestLock = useRef(false);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"scan" | "upload" | "verify" | "revoke" | null>(null);
  const canManage = IDENTITY_DOCUMENT_ROLES.includes(user?.role as (typeof IDENTITY_DOCUMENT_ROLES)[number]);
  const canRevoke = user?.role === "supervisor" || user?.role === "super_admin";

  const query = useQuery({
    queryKey: ["patient-identity-document", patientId],
    queryFn: () => fetchPatientIdentityDocument(patientId),
    enabled: patientId > 0 && canManage,
    staleTime: 30_000,
  });
  const integrationQuery = useQuery({
    queryKey: ["integration-status", "patient-identity-document"],
    queryFn: fetchIntegrationStatus,
    enabled: canManage,
    staleTime: 60_000,
  });
  useEffect(() => () => {
    patientIdRef.current = null;
  }, []);

  if (!canManage) return null;

  const document = query.data?.document ?? null;
  const status = query.data?.status ?? "not_uploaded";
  const documentKey = document
    ? `${patientId}:${document.id}`
    : null;
  const confirmed =
    status === "pending" &&
    documentKey !== null &&
    confirmedFor === documentKey;
  const naps2ScannerEnabled = Boolean(
    integrationQuery.data?.scanner?.naps2WebScanEnabled ||
    integrationQuery.data?.scanner?.scannerBridgeMode === "naps2_webscan"
  );
  const busy = busyAction != null || query.isFetching || integrationQuery.isFetching;

  const refreshIdentityData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["patient-identity-document", patientId],
      }),
      queryClient.invalidateQueries({
        queryKey: patientDirectorySummaryQueryKey(patientId),
      }),
      queryClient.invalidateQueries({
        queryKey: ["patient-directory"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["registrations"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["appointment-manage-modal"],
      }),
    ]);
  };

  const confirmReplacement = () => {
    if (status !== "verified") return true;
    return window.confirm(t(language, "patients.identity.replaceConfirm"));
  };

  const openFilePicker = () => {
    if (!confirmReplacement()) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setBusyAction("upload");
    try {
      await uploadPatientIdentityDocument(patientId, file);
      await refreshIdentityData();
      setConfirmedFor(null);
      pushToast({
        type: "success",
        title: t(language, "patients.identity.uploadSuccess"),
        message: t(language, "patients.identity.pending"),
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: t(language, "patients.identity.actionFailed"),
        message: error instanceof Error ? error.message : t(language, "patients.identity.actionFailed"),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleScanPaper = async () => {
    if (scanRequestLock.current || busy || !naps2ScannerEnabled) return;
    if (!confirmReplacement()) return;

    const scanPatientId = patientId;
    scanRequestLock.current = true;
    setBusyAction("scan");
    try {
      const scanner = integrationQuery.data?.scanner;
      const effectiveScanEndpoint = resolveEffectiveNaps2Endpoint(scanner?.naps2WebScanEndpoint);
      const scanDpi = Number(scanner?.scanDpi || 200);
      const scanColorMode = scanner?.scanColorMode === "color" ? "color" : "grayscale";
      const scanSource = scanner?.scannerSource === "flatbed"
        ? "flatbed"
        : scanner?.scannerSource === "duplex"
          ? "duplex"
          : "feeder";
      const scanResult = await scanAppointmentRequest({
        endpoint: effectiveScanEndpoint.endpoint,
        allowedOrigins: scanner?.naps2WebScanAllowedOrigins,
        dpi: Number.isFinite(scanDpi) && scanDpi > 0 ? scanDpi : 200,
        colorMode: scanColorMode,
        source: scanSource,
        fileName: `patient-${scanPatientId}-identity.pdf`,
      });

      if (patientIdRef.current !== scanPatientId) {
        throw new Error(t(language, "patients.identity.patientChangedDuringScan"));
      }

      const scanFiles = scanResult.files ?? [scanResult.file];
      if (scanFiles.length !== 1 || !scanFiles[0]) {
        throw new Error(t(language, "patients.identity.multipleScanFiles"));
      }

      setBusyAction("upload");
      await uploadPatientIdentityDocument(scanPatientId, scanFiles[0], scanResult.source);
      await refreshIdentityData();
      setConfirmedFor(null);
      pushToast({
        type: "success",
        title: t(language, "patients.identity.uploadSuccess"),
        message: t(language, "patients.identity.pending"),
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: t(language, "documents.scanFailedTitle"),
        message: error instanceof Error ? error.message : t(language, "documents.scanFailedMessage"),
      });
    } finally {
      scanRequestLock.current = false;
      setBusyAction(null);
    }
  };

  const handleVerify = async () => {
    if (!document || !confirmed) return;
    setBusyAction("verify");
    try {
      await verifyPatientIdentityDocument(patientId, document.id);
      await refreshIdentityData();
      setConfirmedFor(null);
      pushToast({
        type: "success",
        title: t(language, "patients.identity.verifySuccess"),
        message: t(language, "patients.identity.verified"),
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: t(language, "patients.identity.actionFailed"),
        message: error instanceof Error ? error.message : t(language, "patients.identity.actionFailed"),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRevoke = async () => {
    if (!window.confirm(t(language, "patients.identity.revokeConfirm"))) return;
    setBusyAction("revoke");
    try {
      await revokePatientIdentityDocument(patientId);
      await refreshIdentityData();
      setConfirmedFor(null);
      pushToast({
        type: "success",
        title: t(language, "patients.identity.revokeSuccess"),
        message: t(language, "patients.identity.notVerified"),
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: t(language, "patients.identity.actionFailed"),
        message: error instanceof Error ? error.message : t(language, "patients.identity.actionFailed"),
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section aria-labelledby="patient-identity-document-heading" className="space-y-3 rounded-xl border border-border bg-muted/10 p-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void handleFileChange(file);
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <h3 id="patient-identity-document-heading" className="text-sm font-semibold text-foreground">
          {t(language, "patients.identity.title")}
        </h3>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
          <PatientIdentityBadge verified={status === "verified"} />
          {status === "verified"
            ? t(language, "patients.identity.verified")
            : status === "pending"
              ? t(language, "patients.identity.pending")
              : t(language, "patients.identity.notVerified")}
        </span>
      </div>

      {query.isLoading ? <p className="text-sm text-muted-foreground" role="status">{t(language, "common.loading")}</p> : null}
      {query.isError ? <p className="text-sm text-destructive" role="alert">{t(language, "patients.identity.actionFailed")}</p> : null}
      {!query.isLoading && !query.isError && !document ? <p className="text-sm text-muted-foreground">{t(language, "patients.identity.noDocument")}</p> : null}

      {document ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">{t(language, "patients.identity.uploadedAt")}</span>
            <span className="text-end font-medium" dir="ltr">{formatDateTimeLy(document.uploadedAt)}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">{t(language, "patients.identity.title")}</span>
            <span className="min-w-0 break-all text-end font-medium">{document.originalFilename}</span>
          </div>
          {document.verifiedAt ? <div className="flex items-start justify-between gap-3"><span className="text-muted-foreground">{t(language, "patients.identity.verifiedAt")}</span><span className="text-end font-medium" dir="ltr">{formatDateTimeLy(document.verifiedAt)}</span></div> : null}
          {document.verifiedByName ? <div className="flex items-start justify-between gap-3"><span className="text-muted-foreground">{t(language, "patients.identity.verifiedBy")}</span><span className="text-end font-medium">{document.verifiedByName}</span></div> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => window.open(`/api/documents/${document.id}/view`, "_blank", "noopener,noreferrer")}>
              {t(language, "patients.identity.view")}
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={openFilePicker}>
              {t(language, "patients.identity.replace")}
            </Button>
            {naps2ScannerEnabled ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void handleScanPaper()}>
                {busyAction === "scan" ? t(language, "documents.scanning") : busyAction === "upload" ? t(language, "documents.uploading") : t(language, "patients.identity.scanPaper")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!document ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={openFilePicker}>{t(language, "patients.identity.upload")}</Button>
          {naps2ScannerEnabled ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void handleScanPaper()}>
              {busyAction === "scan" ? t(language, "documents.scanning") : busyAction === "upload" ? t(language, "documents.uploading") : t(language, "patients.identity.scanPaper")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {document && status === "pending" ? (
        <div className="space-y-3 border-t border-border pt-3">
          <label className="flex items-start gap-2 text-sm leading-5">
            <Checkbox
              checked={confirmed}
              disabled={busy}
              onCheckedChange={(checked) => {
                setConfirmedFor(
                  checked === true ? documentKey : null
                );
              }}
              className="mt-0.5"
            />
            <span>{t(language, "patients.identity.confirmMatch")}</span>
          </label>
          <Button type="button" size="sm" disabled={busy || !confirmed} onClick={() => void handleVerify()}>
            {t(language, "patients.identity.verify")}
          </Button>
        </div>
      ) : null}

      {document && status === "verified" && canRevoke ? <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void handleRevoke()}>{t(language, "patients.identity.revoke")}</Button> : null}
    </section>
  );
}
