import type { PolicyPreviewDto } from "../types";

export function PolicyPreviewPanel({
  preview,
  isLoading,
}: {
  preview: PolicyPreviewDto | null | undefined;
  isLoading: boolean;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid var(--border-color, #e2e8f0)",
        backgroundColor: "var(--bg-surface, #f8fafc)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Draft Preview</h2>
      {isLoading ? (
        <p style={{ fontSize: 14 }}>Loading preview...</p>
      ) : !preview ? (
        <p style={{ fontSize: 14, color: "var(--text-muted, #64748b)" }}>No preview yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <div><strong>Added:</strong> {preview.addedRulesCount}</div>
          <div><strong>Removed:</strong> {preview.removedRulesCount}</div>
          <div><strong>Modified:</strong> {preview.modifiedRulesCount}</div>
          <div>
            <strong>Warnings:</strong>{" "}
            {preview.warnings.length > 0 ? preview.warnings.join("; ") : "none"}
          </div>
        </div>
      )}
    </div>
  );
}

