import type { PolicyAdminValidationResult } from "../utils/policy-admin-validation";

export function PolicyValidationSummary({ result }: { result: PolicyAdminValidationResult }) {
  const hasErrors = result.errors.length > 0;
  const hasWarnings = result.warnings.length > 0;

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        border: hasErrors ? "1px solid rgba(239, 68, 68, 0.45)" : "1px solid var(--border-color, #e2e8f0)",
        background: hasErrors ? "rgba(239, 68, 68, 0.08)" : "var(--bg-surface, #f8fafc)",
        display: "grid",
        gap: 8,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Draft validation</h3>
      {!hasErrors && !hasWarnings ? (
        <p style={{ fontSize: 13, margin: 0, color: "var(--text-muted, #64748b)" }}>No blocking errors or warnings found.</p>
      ) : null}
      {hasErrors && (
        <div>
          <strong style={{ fontSize: 12, color: "var(--color-error, #ef4444)" }}>Blocking errors</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
            {result.errors.map((item, index) => (
              <li key={`error-${index}`}>
                <strong>{item.section}:</strong> {item.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasWarnings && (
        <div>
          <strong style={{ fontSize: 12, color: "var(--color-warning, #f59e0b)" }}>Warnings</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
            {result.warnings.map((item, index) => (
              <li key={`warning-${index}`}>
                <strong>{item.section}:</strong> {item.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
