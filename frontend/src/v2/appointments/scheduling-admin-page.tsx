import { useMemo, useState } from "react";
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
import { PolicyDraftEditor } from "./components/policy-draft-editor";
import { PolicyPreviewPanel } from "./components/policy-preview-panel";
import { PublishPolicyDialog } from "./components/publish-policy-dialog";
import type { PolicySnapshotDto } from "./types";

export function SchedulingAdminV2Page() {
  const { user } = useAuth();
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

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={async () => {
            try {
              await createDraft.mutateAsync({ policySetKey: "default" });
              pushToast({ type: "success", title: "Draft Created", message: "New draft created from published policy." });
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
        >
          Publish Draft
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
          pushToast({ type: "success", title: "Draft Saved", message: "Draft snapshot saved successfully." });
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
