import type { PolicyStatusDto, PolicySnapshotDto } from "../types";

function countRules(snapshot: PolicySnapshotDto): number {
  return (
    (snapshot.categoryDailyLimits.length ?? 0) +
    (snapshot.modalityBlockedRules.length ?? 0) +
    (snapshot.examTypeRules.length ?? 0) +
    (snapshot.examTypeSpecialQuotas.length ?? 0) +
    (snapshot.specialReasonCodes.length ?? 0)
  );
}

function snapshotsDiffer(published: PolicySnapshotDto, draft: PolicySnapshotDto): boolean {
  return JSON.stringify(published) !== JSON.stringify(draft);
}

export function PolicyStatusPanel({ status }: { status: PolicyStatusDto | undefined }) {
  const publishedRuleCount = status?.publishedSnapshot ? countRules(status.publishedSnapshot) : 0;
  const draftRuleCount = status?.draftSnapshot ? countRules(status.draftSnapshot) : 0;
  const hasDraft = status?.draft != null;
  const hasUnpublishedChanges = hasDraft && status?.publishedSnapshot && status?.draftSnapshot
    ? snapshotsDiffer(status.publishedSnapshot, status.draftSnapshot)
    : false;

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid var(--border-color, #e2e8f0)",
        backgroundColor: "var(--bg-surface, #f8fafc)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Policy Status</h2>
      <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
        <div><strong>Policy set:</strong> {status?.policySet?.name ?? "—"}</div>
        <div>
          <strong>Live version:</strong>{" "}
          {status?.published ? `v${status.published.versionNo} (${status.published.configHash.slice(0, 8)})` : "none"}
        </div>
        <div>
          <strong>Working draft:</strong>{" "}
          {status?.draft ? `v${status.draft.versionNo} (${status.draft.configHash.slice(0, 8)})` : "none"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div
            style={{
              padding: 8,
              borderRadius: 6,
              backgroundColor: "var(--bg-card, #ffffff)",
              border: "1px solid var(--border-color, #e2e8f0)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", marginBottom: 4 }}>Live rules</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{publishedRuleCount}</div>
          </div>
          <div
            style={{
              padding: 8,
              borderRadius: 6,
              backgroundColor: "var(--bg-card, #ffffff)",
              border: hasUnpublishedChanges
                ? "2px solid var(--color-warning, #f59e0b)"
                : "1px solid var(--border-color, #e2e8f0)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--color-muted, #64748b)", marginBottom: 4 }}>Working draft</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{draftRuleCount}</div>
          </div>
        </div>

        {hasUnpublishedChanges && (
          <div
            style={{
              padding: 10,
              borderRadius: 6,
              backgroundColor: "var(--color-warning, #f59e0b)",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span>Draft has unpublished changes</span>
          </div>
        )}

        {!hasDraft && (
          <div
            style={{
              padding: 10,
              borderRadius: 6,
              backgroundColor: "var(--color-muted, #64748b)",
              color: "#ffffff",
              fontWeight: 500,
              fontSize: 13,
              textAlign: "center",
            }}
          >
            No working draft. Click "Create Draft" to start editing.
          </div>
        )}
      </div>
    </div>
  );
}

