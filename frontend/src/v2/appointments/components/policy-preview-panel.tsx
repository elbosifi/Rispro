import type { PolicyPreviewDto } from "../types";
import { useLanguage } from "@/providers/language-provider";

export function PolicyPreviewPanel({
  preview,
  isLoading,
}: {
  preview: PolicyPreviewDto | null | undefined;
  isLoading: boolean;
}) {
  const { language } = useLanguage();
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid var(--border-color, #e2e8f0)",
        backgroundColor: "var(--bg-surface, #f8fafc)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{language === "ar" ? "معاينة المسودة" : "Draft Preview"}</h2>
      {isLoading ? (
        <p style={{ fontSize: 14 }}>{language === "ar" ? "جاري تحميل المعاينة..." : "Loading preview..."}</p>
      ) : !preview ? (
        <p style={{ fontSize: 14, color: "var(--text-muted, #64748b)" }}>{language === "ar" ? "لا توجد معاينة بعد." : "No preview yet."}</p>
      ) : (
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <div><strong>{language === "ar" ? "مضافة:" : "Added:"}</strong> {preview.addedRulesCount}</div>
          <div><strong>{language === "ar" ? "محذوفة:" : "Removed:"}</strong> {preview.removedRulesCount}</div>
          <div><strong>{language === "ar" ? "معدلة:" : "Modified:"}</strong> {preview.modifiedRulesCount}</div>
          <div>
            <strong>{language === "ar" ? "تحذيرات:" : "Warnings:"}</strong>{" "}
            {preview.warnings.length > 0 ? preview.warnings.join("; ") : (language === "ar" ? "لا يوجد" : "none")}
          </div>
        </div>
      )}
    </div>
  );
}
