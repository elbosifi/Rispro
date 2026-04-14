import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import {
  useV2PolicyStatus,
  useV2CreatePolicyDraft,
  useV2SavePolicyDraft,
  useV2PolicyPreview,
  useV2PublishPolicyDraft,
} from "./api";
import { PolicyStatusPanel } from "./components/policy-status-panel";
import { LivePolicyPanel } from "./components/live-policy-panel";
import { PolicyDraftEditor } from "./components/policy-draft-editor";
import { PolicyPreviewPanel } from "./components/policy-preview-panel";
import { PublishPolicyDialog } from "./components/publish-policy-dialog";
import type { PolicySnapshotDto } from "./types";

export function SchedulingAdminV2Page() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showPublish, setShowPublish] = useState(false);
  const status = useV2PolicyStatus("default");
  const createDraft = useV2CreatePolicyDraft();
  const saveDraft = useV2SavePolicyDraft();
  const publishDraft = useV2PublishPolicyDraft();

  const draftVersionId = status.data?.draft?.id ?? null;
  const preview = useV2PolicyPreview(draftVersionId);
  const draftSnapshot = useMemo<PolicySnapshotDto | null>(
    () => status.data?.draftSnapshot ?? null,
    [status.data?.draftSnapshot]
  );

  if (user?.role !== "supervisor") {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Scheduling Policies</h1>
        <p style={{ color: "var(--color-error, #ef4444)" }}>Supervisor access required.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Scheduling Policies (V2)</h1>

      {status.isError && (
        <div style={{ color: "var(--color-error, #ef4444)" }}>
          Failed to load status: {(status.error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      <PolicyStatusPanel status={status.data} />

      {status.data?.publishedSnapshot ? (
        <LivePolicyPanel snapshot={status.data.publishedSnapshot} />
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
          No live policy published yet.
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={async () => {
            try {
              await createDraft.mutateAsync({ policySetKey: "default" });
              pushToast({ type: "success", title: "Draft Created", message: "New working draft created from published policy." });
            } catch (error) {
              pushToast({
                type: "error",
                title: "Draft Creation Failed",
                message: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }}
          disabled={createDraft.isPending || Boolean(status.data?.draft)}
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0" }}
        >
          Create Draft
        </button>

        <button
          type="button"
          onClick={() => setShowPublish(true)}
          disabled={!draftVersionId || publishDraft.isPending}
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0" }}
          title="Publish the working draft to make it live"
        >
          Publish Draft (Make Live)
        </button>
      </div>

      <PolicyDraftEditor
        snapshot={draftSnapshot}
        isSaving={saveDraft.isPending}
        onSave={async (nextSnapshot, changeNote) => {
          if (!draftVersionId) {
            pushToast({ type: "error", title: "No Draft", message: "Create a draft first." });
            return;
          }
          await saveDraft.mutateAsync({ versionId: draftVersionId, policySnapshot: nextSnapshot, changeNote });
          // Refresh both status and preview caches to show updated draft count
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["v2-policy-status"] }),
            queryClient.invalidateQueries({ queryKey: ["v2-policy-preview", draftVersionId] }),
          ]);
          pushToast({
            type: "success",
            title: "Draft Saved",
            message: "Working draft snapshot saved successfully. This is your working copy — use 'Publish Draft' to make it live.",
          });
        }}
      />

      <PolicyPreviewPanel preview={preview.data} isLoading={preview.isLoading} />

      <PublishPolicyDialog
        isOpen={showPublish}
        onClose={() => setShowPublish(false)}
        isPublishing={publishDraft.isPending}
        onPublish={async (changeNote) => {
          if (!draftVersionId) {
            pushToast({ type: "error", title: "No Draft", message: "Create a draft first." });
            return;
          }
          await publishDraft.mutateAsync({ versionId: draftVersionId, changeNote });
          pushToast({ type: "success", title: "Draft Published", message: "Policy published successfully." });
          setShowPublish(false);
        }}
      />
    </div>
  );
}
