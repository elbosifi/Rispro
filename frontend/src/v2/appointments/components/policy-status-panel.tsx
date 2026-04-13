import type { PolicyStatusDto } from "../types";

export function PolicyStatusPanel({ status }: { status: PolicyStatusDto | undefined }) {
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
          <strong>Published:</strong>{" "}
          {status?.published ? `v${status.published.versionNo} (${status.published.configHash.slice(0, 8)})` : "none"}
        </div>
        <div>
          <strong>Draft:</strong>{" "}
          {status?.draft ? `v${status.draft.versionNo} (${status.draft.configHash.slice(0, 8)})` : "none"}
        </div>
        <div>
          <strong>Published rules:</strong> {(status?.publishedSnapshot.categoryDailyLimits.length ?? 0) +
            (status?.publishedSnapshot.modalityBlockedRules.length ?? 0) +
            (status?.publishedSnapshot.examTypeRules.length ?? 0) +
            (status?.publishedSnapshot.examTypeSpecialQuotas.length ?? 0)}
        </div>
      </div>
    </div>
  );
}

