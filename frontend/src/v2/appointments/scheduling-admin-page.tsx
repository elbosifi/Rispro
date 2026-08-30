import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import {
  useV2PolicyStatus,
  useV2CreatePolicyDraft,
  useV2SavePolicyDraft,
  useV2PolicyPreview,
  useV2PublishPolicyDraft,
  useV2Lookups,
  useV2ExamTypeCatalog,
  useV2PolicyUsers,
} from "./api";
import { PolicyStatusPanel } from "./components/policy-status-panel";
import { LivePolicyPanel } from "./components/live-policy-panel";
import { PolicyDraftEditor } from "./components/policy-draft-editor";
import { PolicyPreviewPanel } from "./components/policy-preview-panel";
import { PublishPolicyDialog } from "./components/publish-policy-dialog";
import { PolicyValidationSummary } from "./components/policy-validation-summary";
import { getPolicyDiffRiskSummary } from "./utils/policy-diff-risk";
import { validatePolicyDraftForAdmin } from "./utils/policy-admin-validation";
import type { PolicySnapshotDto } from "./types";

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{
        display: "grid",
        gap: 12,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function snapshotsDiffer(published: PolicySnapshotDto | undefined, draft: PolicySnapshotDto | undefined): boolean {
  if (!published || !draft) return false;
  const publishedVersioned = { ...published, specialReasonCodes: [] };
  const draftVersioned = { ...draft, specialReasonCodes: [] };
  return JSON.stringify(publishedVersioned) !== JSON.stringify(draftVersioned);
}

export function SchedulingAdminPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [showPublish, setShowPublish] = useState(false);
  const status = useV2PolicyStatus("default");
  const createDraft = useV2CreatePolicyDraft();
  const saveDraft = useV2SavePolicyDraft();
  const publishDraft = useV2PublishPolicyDraft();
  const lookups = useV2Lookups();
  const examTypeCatalog = useV2ExamTypeCatalog();
  const policyUsers = useV2PolicyUsers();

  const draftVersionId = status.data?.draft?.id ?? null;
  const preview = useV2PolicyPreview(draftVersionId);
  const draftSnapshot = useMemo<PolicySnapshotDto | null>(
    () => status.data?.draftSnapshot ?? null,
    [status.data?.draftSnapshot]
  );
  const validation = useMemo(
    () => validatePolicyDraftForAdmin(draftSnapshot, status.data?.displayLookups),
    [draftSnapshot, status.data?.displayLookups]
  );
  const riskSummary = useMemo(
    () => getPolicyDiffRiskSummary(status.data?.publishedSnapshot, status.data?.draftSnapshot, status.data?.displayLookups),
    [status.data?.displayLookups, status.data?.draftSnapshot, status.data?.publishedSnapshot]
  );
  const hasBlockingValidationErrors = validation.errors.length > 0;
  const hasValidationWarnings = validation.warnings.length > 0;
  const hasUnpublishedChanges = snapshotsDiffer(status.data?.publishedSnapshot, status.data?.draftSnapshot);
  const publishDisabledReason = !draftVersionId
    ? t("schedulingAdmin.createDraftBeforePublishing")
    : hasBlockingValidationErrors
    ? t("schedulingAdmin.resolveBlockingErrors")
    : publishDraft.isPending
    ? t("schedulingAdmin.publishInProgress")
    : null;

  if (user?.role !== "supervisor" && user?.role !== "super_admin") {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t("schedulingAdmin.accessDeniedTitle")}</h1>
        <p style={{ color: "var(--color-error, #ef4444)" }}>{t("schedulingAdmin.supervisorRequired")}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>{t("schedulingAdmin.title")}</h1>

      {status.isError && (
        <div style={{ color: "var(--color-error, #ef4444)" }}>
          {t("schedulingAdmin.statusLoadFailed")}: {(status.error as Error)?.message ?? t("schedulingAdmin.unknownError")}
        </div>
      )}

      <SectionCard title={t("schedulingAdmin.status")}>
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: "1px solid var(--border-color, #e2e8f0)",
            backgroundColor: "var(--bg-surface, #f8fafc)",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontSize: 13 }}>
            <div>{t("schedulingAdmin.liveVersion", { version: status.data?.published ? `v${status.data.published.versionNo}` : t("schedulingAdmin.none") })}</div>
            <div>{t("schedulingAdmin.draftVersion", { version: status.data?.draft ? `v${status.data.draft.versionNo}` : t("schedulingAdmin.none") })}</div>
            <div>{t("schedulingAdmin.draftState", { state: t(hasUnpublishedChanges ? "schedulingAdmin.unpublishedChanges" : "schedulingAdmin.noUnpublishedChanges") })}</div>
            <div>
              <strong>Validation:</strong>{" "}
              {hasBlockingValidationErrors
                ? `${validation.errors.length} blocking error${validation.errors.length === 1 ? "" : "s"}`
                : hasValidationWarnings
                ? `${validation.warnings.length} warning${validation.warnings.length === 1 ? "" : "s"}`
                : "valid"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={async () => {
                try {
                  await createDraft.mutateAsync({ policySetKey: "default" });
                  pushToast({ type: "success", title: t("schedulingAdmin.draftCreated"), message: t("schedulingAdmin.draftCreatedMessage") });
                } catch (error) {
                  pushToast({
                    type: "error",
                    title: t("schedulingAdmin.draftCreationFailed"),
                    message: error instanceof Error ? error.message : t("schedulingAdmin.unknownError"),
                  });
                }
              }}
              disabled={createDraft.isPending || Boolean(status.data?.draft)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0" }}
            >
              {t("schedulingAdmin.createDraft")}
            </button>

            <button
              type="button"
              onClick={() => setShowPublish(true)}
              disabled={Boolean(publishDisabledReason)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0" }}
              title={publishDisabledReason ?? t("schedulingAdmin.publishDraftTitle")}
            >
              {t("schedulingAdmin.publishDraft")}
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{t("schedulingAdmin.saveDraftHint")}</span>
          </div>
          {publishDisabledReason && (
            <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{publishDisabledReason}</div>
          )}
        </div>

        <PolicyStatusPanel status={status.data} />
      </SectionCard>

      <section aria-label={t("schedulingAdmin.livePolicy")} style={{ display: "grid", gap: 12 }}>
        {status.data?.publishedSnapshot ? (
          <LivePolicyPanel
            snapshot={status.data.publishedSnapshot}
            modalities={lookups.data?.modalities ?? []}
            examTypes={examTypeCatalog.data ?? []}
            policyUsers={policyUsers.data ?? []}
            displayLookups={status.data.displayLookups}
          />
        ) : (
          <div
            style={{
              padding: 16,
              borderRadius: 8,
              border: "1px solid var(--border-color, #e2e8f0)",
              backgroundColor: "var(--bg-surface, #f8fafc)",
              textAlign: "center",
              color: "var(--text-muted, #64748b)",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>{t("schedulingAdmin.livePolicy")}</h2>
            {t("schedulingAdmin.noLivePolicy")}
          </div>
        )}
      </section>

      <SectionCard title={t("schedulingAdmin.workingDraft")}>
        <PolicyValidationSummary result={validation} />
        <PolicyDraftEditor
          snapshot={draftSnapshot}
          displayLookups={status.data?.displayLookups}
          externalValidationErrors={validation.errors.map((item) => `${item.section}: ${item.message}`)}
          isSaving={saveDraft.isPending}
          onSave={async (nextSnapshot, changeNote) => {
            if (!draftVersionId) {
              pushToast({ type: "error", title: t("schedulingAdmin.noDraft"), message: t("schedulingAdmin.createDraftFirst") });
              return;
            }
            await saveDraft.mutateAsync({ versionId: draftVersionId, policySnapshot: nextSnapshot, changeNote });
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["v2-policy-status"] }),
              queryClient.invalidateQueries({ queryKey: ["v2-policy-preview", draftVersionId] }),
            ]);
            pushToast({
              type: "success",
              title: t("schedulingAdmin.draftSaved"),
              message: t("schedulingAdmin.draftSavedMessage"),
            });
          }}
        />
      </SectionCard>

      <SectionCard title={t("schedulingAdmin.previewDiff")}>
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-color, #e2e8f0)",
              backgroundColor: "var(--bg-surface, #f8fafc)",
              fontSize: 13,
              display: "grid",
              gap: 6,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t("schedulingAdmin.beforePublishing")}</h2>
            <div>
              <strong>{t("schedulingAdmin.validation")}:</strong>{" "}
              {hasBlockingValidationErrors
                ? t(validation.errors.length === 1 ? "schedulingAdmin.blockingErrorOne" : "schedulingAdmin.blockingErrorsMany", { count: validation.errors.length })
                : hasValidationWarnings
                ? t(validation.warnings.length === 1 ? "schedulingAdmin.warningOne" : "schedulingAdmin.warningsMany", { count: validation.warnings.length })
                : t("schedulingAdmin.valid")}
            </div>
            <div>
              <strong>{t("schedulingAdmin.preview")}:</strong>{" "}
              {preview.data
                ? t("schedulingAdmin.previewSummary", { added: preview.data.addedRulesCount, removed: preview.data.removedRulesCount, modified: preview.data.modifiedRulesCount })
                : t("schedulingAdmin.notLoaded")}
            </div>
            <div><strong>{t("schedulingAdmin.highRiskWarnings")}:</strong> {riskSummary.highRiskWarnings.length}</div>
            {riskSummary.highRiskWarnings.length > 0 && (
              <ul style={{ margin: 0, paddingInlineStart: 18, color: "var(--color-warning, #92400e)" }}>
                {riskSummary.highRiskWarnings.slice(0, 3).map((warning, index) => (
                  <li key={`${warning.section}-${warning.ruleId ?? "none"}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            )}
            <div style={{ color: "var(--text-muted, #64748b)" }}>{t("schedulingAdmin.publishMakesLive")}</div>
          </div>
          <PolicyPreviewPanel preview={preview.data} isLoading={preview.isLoading} riskSummary={riskSummary} />
        </div>
      </SectionCard>

      <SectionCard title={t("schedulingAdmin.advanced")}>
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border-color, #e2e8f0)",
            backgroundColor: "var(--bg-surface, #f8fafc)",
            fontSize: 13,
            color: "var(--text-muted, #64748b)",
          }}
        >
          {t("schedulingAdmin.rawJsonDebug")}
        </div>
      </SectionCard>

      <PublishPolicyDialog
        isOpen={showPublish}
        onClose={() => setShowPublish(false)}
        isPublishing={publishDraft.isPending}
        onPublish={async (changeNote) => {
          if (!draftVersionId) {
            pushToast({ type: "error", title: t("schedulingAdmin.noDraft"), message: t("schedulingAdmin.createDraftFirst") });
            return;
          }
          await publishDraft.mutateAsync({ versionId: draftVersionId, changeNote });
          pushToast({ type: "success", title: t("schedulingAdmin.draftPublished"), message: t("schedulingAdmin.policyPublished") });
          setShowPublish(false);
        }}
      />
    </div>
  );
}
