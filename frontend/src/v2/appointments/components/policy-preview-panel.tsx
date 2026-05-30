import type { PolicyPreviewDto } from "../types";
import type { PolicyDiffRiskSummary } from "../utils/policy-diff-risk";

export function PolicyPreviewPanel({
  preview,
  isLoading,
  riskSummary,
}: {
  preview: PolicyPreviewDto | null | undefined;
  isLoading: boolean;
  riskSummary?: PolicyDiffRiskSummary;
}) {
  const affectedSections = riskSummary?.affectedSections ?? [];
  const highRiskWarnings = riskSummary?.highRiskWarnings ?? [];
  const warningGroups = highRiskWarnings.reduce<Array<{ section: string; warnings: typeof highRiskWarnings }>>((groups, warning) => {
    const existing = groups.find((group) => group.section === warning.section);
    if (existing) existing.warnings.push(warning);
    else groups.push({ section: warning.section, warnings: [warning] });
    return groups;
  }, []);

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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
            <div><strong>Added:</strong> {preview.addedRulesCount}</div>
            <div><strong>Removed:</strong> {preview.removedRulesCount}</div>
            <div><strong>Modified:</strong> {preview.modifiedRulesCount}</div>
          </div>
          <div>
            <strong>Affected sections:</strong> {affectedSections.length > 0 ? affectedSections.join(", ") : "none"}
          </div>
          <div>
            <strong>Backend warnings:</strong> {preview.warnings.length > 0 ? preview.warnings.join("; ") : "none"}
          </div>
          <div>
            <strong>High-risk changes:</strong>{" "}
            {highRiskWarnings.length > 0 ? `${highRiskWarnings.length} warning${highRiskWarnings.length === 1 ? "" : "s"}` : "none"}
          </div>
          {warningGroups.length > 0 && (
            <div style={{ display: "grid", gap: 8, color: "var(--color-warning, #92400e)" }}>
              {warningGroups.map((group) => (
                <div key={group.section}>
                  <strong>{group.section} ({group.warnings.length})</strong>
                  <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
                    {group.warnings.slice(0, 4).map((warning, index) => (
                      <li key={`${warning.ruleId ?? "none"}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
