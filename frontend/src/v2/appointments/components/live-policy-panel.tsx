/**
 * Appointments V2 — Read-only live policy viewer.
 *
 * Displays the published policy snapshot in an accordion structure
 * identical to the draft editor, but without any editable inputs.
 */

import { useState } from "react";
import type { ExamTypeDto, ModalityDto, PolicySnapshotDto, PolicyUserDto } from "../types";
import { useLanguage } from "@/providers/language-provider";

interface LivePolicyPanelProps {
  snapshot: PolicySnapshotDto;
  modalities?: ModalityDto[];
  examTypes?: ExamTypeDto[];
  policyUsers?: PolicyUserDto[];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("en-LY", { year: "numeric", month: "short", day: "numeric" });
}

function AccordionSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen}>
      <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>{title}</summary>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </details>
  );
}

function EmptyMessage({ message }: { message: string }) {
  return (
    <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>{message}</div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted, #64748b)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--text-primary, #1e293b)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function formatModality(modalityId: number, modalities: ModalityDto[], language: string): string {
  const modality = modalities.find((row) => row.id === modalityId);
  if (!modality) return `ID: ${modalityId}`;
  const name = language === "ar" ? modality.nameAr || modality.name : modality.nameEn || modality.name;
  return modality.code ? `${name} (${modality.code})` : name;
}

function formatExamTypes(examTypeIds: number[], examTypes: ExamTypeDto[], language: string): string {
  if (examTypeIds.length === 0) return "—";
  return examTypeIds
    .map((examTypeId) => {
      const examType = examTypes.find((row) => row.id === examTypeId);
      if (!examType) return `ID: ${examTypeId}`;
      const name = language === "ar" ? examType.nameAr || examType.name : examType.nameEn || examType.name;
      return examType.code ? `${name} (${examType.code})` : name;
    })
    .join(", ");
}

function formatAllowedUsers(userIds: number[], policyUsers: PolicyUserDto[]): string {
  if (userIds.length === 0) return "Super admin only";
  return userIds
    .map((userId) => {
      const user = policyUsers.find((row) => row.id === userId);
      return user ? `${user.fullName || user.username} (${user.username})` : `ID: ${userId}`;
    })
    .join(", ");
}

export function LivePolicyPanel({ snapshot, modalities = [], examTypes = [], policyUsers = [] }: LivePolicyPanelProps) {
  const { language } = useLanguage();
  const [copied, setCopied] = useState(false);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = JSON.stringify(snapshot, null, 2);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid var(--border-color, #e2e8f0)",
        backgroundColor: "var(--bg-surface, #f8fafc)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{language === "ar" ? "السياسة المباشرة" : "Live Policy"}</h2>
        <button
          type="button"
          onClick={handleCopyJson}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--border-color, #e2e8f0)",
            background: "var(--bg-card, #fff)",
            fontSize: 12,
            cursor: "pointer",
          }}
          title={language === "ar" ? "نسخ لقطة السياسة المباشرة كـ JSON" : "Copy live policy snapshot as JSON"}
        >
          {copied ? (language === "ar" ? "✓ تم النسخ" : "✓ Copied") : (language === "ar" ? "نسخ JSON" : "Copy JSON")}
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {/* Daily category limits */}
        <AccordionSection title={language === "ar" ? "حدود الفئات اليومية" : "Daily category limits"} defaultOpen>
          {snapshot.categoryDailyLimits.length === 0 ? (
            <EmptyMessage message={language === "ar" ? "لا توجد حدود فئات يومية." : "No daily category limits configured."} />
          ) : (
            snapshot.categoryDailyLimits.map((row, index) => (
              <div
                key={`${row.id}-${index}`}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #e2e8f0)",
                  backgroundColor: "var(--bg-card, #fff)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 8,
                }}
              >
                <ReadOnlyField label={language === "ar" ? "الجهاز" : "Modality"} value={formatModality(row.modalityId, modalities, language)} />
                <ReadOnlyField label={language === "ar" ? "الفئة" : "Category"} value={row.caseCategory === "oncology" ? (language === "ar" ? "أورام" : "Oncology") : (language === "ar" ? "غير أورام" : "Non-oncology")} />
                <ReadOnlyField label={language === "ar" ? "الحد اليومي" : "Daily limit"} value={row.dailyLimit} />
                <ReadOnlyField label={language === "ar" ? "الحالة" : "Status"} value={row.isActive ? (language === "ar" ? "نشط" : "Active") : (language === "ar" ? "غير نشط" : "Inactive")} />
              </div>
            ))
          )}
        </AccordionSection>

        {/* Blocked dates */}
        <AccordionSection title={language === "ar" ? "التواريخ المحجوبة" : "Blocked dates"}>
          {snapshot.modalityBlockedRules.length === 0 ? (
            <EmptyMessage message={language === "ar" ? "لا توجد تواريخ محجوبة." : "No blocked dates configured."} />
          ) : (
            snapshot.modalityBlockedRules.map((row, index) => {
              const ruleTypeLabel =
                row.ruleType === "specific_date"
                  ? (language === "ar" ? "تاريخ محدد" : "Specific date")
                  : row.ruleType === "date_range"
                  ? (language === "ar" ? "نطاق تاريخ" : "Date range")
                  : (language === "ar" ? "تكرار سنوي" : "Yearly recurrence");

              let dateDisplay = "—";
              if (row.ruleType === "specific_date") {
                dateDisplay = formatDate(row.specificDate);
              } else if (row.ruleType === "date_range") {
                dateDisplay = `${formatDate(row.startDate)} → ${formatDate(row.endDate)}`;
              } else if (row.ruleType === "yearly_recurrence") {
                const startMonth = row.recurStartMonth ?? "—";
                const startDay = row.recurStartDay ?? "—";
                const endMonth = row.recurEndMonth ?? "—";
                const endDay = row.recurEndDay ?? "—";
                dateDisplay = `Month ${startMonth}/Day ${startDay} → Month ${endMonth}/Day ${endDay}`;
              }

              return (
                <div
                  key={`${row.id}-${index}`}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid var(--border-color, #e2e8f0)",
                    backgroundColor: "var(--bg-card, #fff)",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                    gap: 8,
                  }}
                >
                <ReadOnlyField label={language === "ar" ? "الجهاز" : "Modality"} value={formatModality(row.modalityId, modalities, language)} />
                <ReadOnlyField label={language === "ar" ? "نوع القاعدة" : "Rule type"} value={ruleTypeLabel} />
                <ReadOnlyField label={language === "ar" ? "التاريخ/التواريخ" : "Date(s)"} value={dateDisplay} />
                <ReadOnlyField label={language === "ar" ? "قابل للتجاوز" : "Overridable"} value={row.isOverridable ? (language === "ar" ? "نعم" : "Yes") : (language === "ar" ? "لا" : "No")} />
                <ReadOnlyField label={language === "ar" ? "الحالة" : "Status"} value={row.isActive ? (language === "ar" ? "نشط" : "Active") : (language === "ar" ? "غير نشط" : "Inactive")} />
                {row.title && <ReadOnlyField label={language === "ar" ? "العنوان" : "Title"} value={row.title} />}
                {row.notes && <ReadOnlyField label={language === "ar" ? "الملاحظات" : "Notes"} value={row.notes} />}
                </div>
              );
            })
          )}
        </AccordionSection>

        {/* Exam date rules */}
        <AccordionSection title={language === "ar" ? "قواعد تواريخ الفحص" : "Exam date rules"}>
          {snapshot.examTypeRules.length === 0 ? (
            <EmptyMessage message={language === "ar" ? "لا توجد قواعد لتواريخ الفحص." : "No exam date rules configured."} />
          ) : (
            snapshot.examTypeRules.map((row, index) => {
              const ruleTypeLabel =
                row.ruleType === "specific_date"
                  ? (language === "ar" ? "تاريخ محدد" : "Specific date")
                  : row.ruleType === "date_range"
                  ? (language === "ar" ? "نطاق تاريخ" : "Date range")
                  : (language === "ar" ? "تكرار أسبوعي" : "Weekly recurrence");

              let dateDisplay = "—";
              if (row.ruleType === "specific_date") {
                dateDisplay = formatDate(row.specificDate);
              } else if (row.ruleType === "date_range") {
                dateDisplay = `${formatDate(row.startDate)} → ${formatDate(row.endDate)}`;
              } else if (row.ruleType === "weekly_recurrence") {
                const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                const weekday = row.weekday != null ? weekdays[row.weekday] : "—";
                dateDisplay = `${weekday}${row.alternateWeeks ? " (alternate weeks)" : ""}`;
              }

              const effectLabel =
                row.effectMode === "hard_restriction" ? (language === "ar" ? "تقييد صارم" : "Hard restriction") : (language === "ar" ? "تقييد قابل للتجاوز" : "Overridable restriction");

              return (
                <div
                  key={`${row.id}-${index}`}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid var(--border-color, #e2e8f0)",
                    backgroundColor: "var(--bg-card, #fff)",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                    gap: 8,
                  }}
                >
                  <ReadOnlyField label="Modality" value={formatModality(row.modalityId, modalities, language)} />
                  <ReadOnlyField label="Rule type" value={ruleTypeLabel} />
                  <ReadOnlyField label="Date(s)" value={dateDisplay} />
                  <ReadOnlyField label="Effect" value={effectLabel} />
                  <ReadOnlyField label="Exam types" value={formatExamTypes(row.examTypeIds, examTypes, language)} />
                  <ReadOnlyField label="Status" value={row.isActive ? "Active" : "Inactive"} />
                  {row.title && <ReadOnlyField label="Title" value={row.title} />}
                  {row.notes && <ReadOnlyField label="Notes" value={row.notes} />}
                </div>
              );
            })
          )}
        </AccordionSection>

        {/* Special quotas */}
        <AccordionSection title="Exam mix quota groups">
          {(snapshot.examMixQuotaRules ?? []).length === 0 ? (
            <EmptyMessage message="No exam mix quota groups configured." />
          ) : (
            (snapshot.examMixQuotaRules ?? []).map((row, index) => (
              <div
                key={`${row.id}-${index}`}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #e2e8f0)",
                  backgroundColor: "var(--bg-card, #fff)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 8,
                }}
              >
                <ReadOnlyField label="Modality" value={formatModality(row.modalityId, modalities, language)} />
                <ReadOnlyField label="Title" value={row.title ?? "—"} />
                <ReadOnlyField label="Rule type" value={row.ruleType} />
                <ReadOnlyField label="Daily limit" value={row.dailyLimit} />
                <ReadOnlyField label="Exam types" value={formatExamTypes(row.examTypeIds, examTypes, language)} />
                <ReadOnlyField label="Status" value={row.isActive ? "Active" : "Inactive"} />
              </div>
            ))
          )}
        </AccordionSection>

        {/* Special quotas */}
        <AccordionSection title="Special quotas">
          {snapshot.examTypeSpecialQuotas.length === 0 ? (
            <EmptyMessage message="No special quotas configured." />
          ) : (
            snapshot.examTypeSpecialQuotas.map((row, index) => (
              <div
                key={`${row.id}-${index}`}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #e2e8f0)",
                  backgroundColor: "var(--bg-card, #fff)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 8,
                }}
              >
                <ReadOnlyField label="Exam type" value={formatExamTypes([row.examTypeId], examTypes, language)} />
                <ReadOnlyField label="Extra slots/day" value={row.dailyExtraSlots} />
                <ReadOnlyField label="Allowed users" value={formatAllowedUsers(row.allowedUserIds ?? [], policyUsers)} />
                <ReadOnlyField label="Status" value={row.isActive ? "Active" : "Inactive"} />
              </div>
            ))
          )}
        </AccordionSection>

        {/* Special reason codes */}
        <AccordionSection title="Special reason codes (global)">
          {snapshot.specialReasonCodes.length === 0 ? (
            <EmptyMessage message="No special reason codes configured." />
          ) : (
            snapshot.specialReasonCodes.map((row, index) => (
              <div
                key={`${row.code}-${index}`}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #e2e8f0)",
                  backgroundColor: "var(--bg-card, #fff)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 8,
                }}
              >
                <ReadOnlyField label="Code" value={row.code} />
                <ReadOnlyField label="English" value={row.labelEn || "—"} />
                <ReadOnlyField label="Arabic" value={row.labelAr || "—"} />
                <ReadOnlyField label="Status" value={row.isActive ? "Active" : "Inactive"} />
              </div>
            ))
          )}
        </AccordionSection>
      </div>
    </div>
  );
}
