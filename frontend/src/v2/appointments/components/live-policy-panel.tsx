import { useState, type ReactNode } from "react";
import type { ExamTypeDto, ModalityDto, PolicyDisplayLookupsDto, PolicySnapshotDto, PolicyUserDto } from "../types";

interface LivePolicyPanelProps {
  snapshot: PolicySnapshotDto;
  modalities?: ModalityDto[];
  examTypes?: ExamTypeDto[];
  policyUsers?: PolicyUserDto[];
  displayLookups?: PolicyDisplayLookupsDto;
}

type RefWarning = { kind: "unknown" | "inactive" | "empty"; message: string };

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(`${dateStr}T00:00:00Z`);
  return date.toLocaleDateString("en-LY", { year: "numeric", month: "short", day: "numeric" });
}

function formatRuleType(ruleType: string): string {
  if (ruleType === "date_range") return "Date range";
  if (ruleType === "weekly_recurrence") return "Weekly recurrence";
  if (ruleType === "yearly_recurrence") return "Yearly recurrence";
  return "Specific date";
}

function formatEffectMode(effectMode: string): string {
  return effectMode === "hard_restriction" ? "Hard restriction" : "Supervisor-overridable restriction";
}

function formatSchedule(row: {
  ruleType: string;
  specificDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  weekday?: number | null;
  alternateWeeks?: boolean;
  recurrenceAnchorDate?: string | null;
  recurStartMonth?: number | null;
  recurStartDay?: number | null;
  recurEndMonth?: number | null;
  recurEndDay?: number | null;
}): string {
  if (row.ruleType === "date_range") return `${formatDate(row.startDate ?? null)} to ${formatDate(row.endDate ?? null)}`;
  if (row.ruleType === "weekly_recurrence") {
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const weekday = row.weekday == null ? "Weekday not set" : weekdays[row.weekday] ?? "Weekday not set";
    return `${weekday}${row.alternateWeeks ? ", alternate weeks" : ""}${row.recurrenceAnchorDate ? ` from ${formatDate(row.recurrenceAnchorDate)}` : ""}`;
  }
  if (row.ruleType === "yearly_recurrence") {
    return `Month ${row.recurStartMonth ?? "-"}/Day ${row.recurStartDay ?? "-"} to Month ${row.recurEndMonth ?? "-"}/Day ${row.recurEndDay ?? "-"}`;
  }
  return formatDate(row.specificDate ?? null);
}

function Section({ title, count, defaultOpen = false, children }: { title: string; count: number; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen}>
      <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 8 }}>
        {title} ({count})
      </summary>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </details>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 6,
        border: "1px solid var(--border-color, #e2e8f0)",
        backgroundColor: "var(--bg-card, #fff)",
        display: "grid",
        gap: 8,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, color: "var(--text-muted, #64748b)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--text-primary, #1e293b)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Badge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        width: "fit-content",
        borderRadius: 999,
        border: "1px solid var(--border-color, #e2e8f0)",
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        color: active ? "var(--color-success, #047857)" : "var(--text-muted, #64748b)",
      }}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function EmptyMessage({ message }: { message: string }) {
  return <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", fontStyle: "italic" }}>{message}</div>;
}

function getModality(
  modalityId: number,
  modalities: Array<Pick<ModalityDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "isActive">>
) {
  return modalities.find((row) => Number(row.id) === Number(modalityId));
}

function getExamType(
  examTypeId: number,
  examTypes: Array<Pick<ExamTypeDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "isActive">>
) {
  return examTypes.find((row) => Number(row.id) === Number(examTypeId));
}

function formatModality(modalityId: number, modalities: Array<Pick<ModalityDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "isActive">>): string {
  const modality = getModality(modalityId, modalities);
  if (!modality) return `Unknown modality ID ${modalityId}`;
  const label = modality.code ? `${modality.nameEn || modality.name} (${modality.code})` : modality.nameEn || modality.name;
  return modality.isActive === false ? `${label} (inactive)` : label;
}

function formatExamType(examTypeId: number, examTypes: Array<Pick<ExamTypeDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "isActive">>): string {
  const examType = getExamType(examTypeId, examTypes);
  if (!examType) return `Unknown exam type ID ${examTypeId}`;
  const label = examType.code ? `${examType.nameEn || examType.name} (${examType.code})` : examType.nameEn || examType.name;
  return examType.isActive === false ? `${label} (inactive)` : label;
}

function formatAllowedUsers(userIds: number[], policyUsers: PolicyUserDto[]): string {
  if (userIds.length === 0) return "Super admin only";
  return userIds
    .map((userId) => {
      const user = policyUsers.find((row) => Number(row.id) === Number(userId));
      if (!user) return `Unknown user ID ${userId}`;
      const label = `${user.fullName || user.username} (${user.username})`;
      return user.isActive === false ? `${label} (inactive)` : label;
    })
    .join(", ");
}

function ExamChips({
  examTypeIds,
  examTypes,
}: {
  examTypeIds: number[];
  examTypes: Array<Pick<ExamTypeDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "isActive">>;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>Selected exams ({examTypeIds.length})</span>
      {examTypeIds.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>No selected exams.</span>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {examTypeIds.map((examTypeId) => (
            <span key={examTypeId} style={{ border: "1px solid var(--border-color, #e2e8f0)", borderRadius: 4, padding: "3px 6px", fontSize: 12 }}>
              {formatExamType(examTypeId, examTypes)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function collectWarnings(
  snapshot: PolicySnapshotDto,
  modalities: Array<Pick<ModalityDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "isActive">>,
  examTypes: Array<Pick<ExamTypeDto, "id" | "name" | "nameAr" | "nameEn" | "code" | "isActive">>,
  users: PolicyUserDto[]
): RefWarning[] {
  const warnings: RefWarning[] = [];
  const addModality = (section: string, modalityId: number) => {
    const modality = getModality(modalityId, modalities);
    if (!modality) warnings.push({ kind: "unknown", message: `${section}: unknown modality reference ${modalityId}.` });
    else if (modality.isActive === false) warnings.push({ kind: "inactive", message: `${section}: inactive modality ${modality.nameEn || modality.name}.` });
  };
  const addExamType = (section: string, examTypeId: number) => {
    const examType = getExamType(examTypeId, examTypes);
    if (!examType) warnings.push({ kind: "unknown", message: `${section}: unknown exam type reference ${examTypeId}.` });
    else if (examType.isActive === false) warnings.push({ kind: "inactive", message: `${section}: inactive exam type ${examType.nameEn || examType.name}.` });
  };
  const addUser = (section: string, userId: number) => {
    const user = users.find((row) => Number(row.id) === Number(userId));
    if (!user) warnings.push({ kind: "unknown", message: `${section}: unknown user reference ${userId}.` });
    else if (user.isActive === false) warnings.push({ kind: "inactive", message: `${section}: inactive user ${user.fullName || user.username}.` });
  };

  snapshot.categoryDailyLimits.forEach((row) => addModality("Daily category limits", row.modalityId));
  snapshot.modalityBlockedRules.forEach((row) => addModality("Blocked dates", row.modalityId));
  snapshot.examTypeRules.forEach((row) => {
    addModality("Exam restriction rules", row.modalityId);
    if (row.isActive && row.examTypeIds.length === 0) warnings.push({ kind: "empty", message: `Exam restriction rule ${row.id}: active rule has no selected exams.` });
    row.examTypeIds.forEach((examTypeId) => addExamType("Exam restriction rules", examTypeId));
  });
  (snapshot.examMixQuotaRules ?? []).forEach((row) => {
    addModality("Exam mix quota groups", row.modalityId);
    if (row.isActive && row.examTypeIds.length === 0) warnings.push({ kind: "empty", message: `Exam mix group ${row.id}: active group has no selected exams.` });
    row.examTypeIds.forEach((examTypeId) => addExamType("Exam mix quota groups", examTypeId));
  });
  snapshot.examTypeSpecialQuotas.forEach((row) => {
    addExamType("Special quotas", row.examTypeId);
    (row.allowedUserIds ?? []).forEach((userId) => addUser("Special quotas", userId));
  });
  return warnings;
}

export function LivePolicyPanel({
  snapshot,
  modalities = [],
  examTypes = [],
  policyUsers = [],
  displayLookups,
}: LivePolicyPanelProps) {
  const [copied, setCopied] = useState(false);
  const resolvedModalities = displayLookups?.modalities ?? modalities;
  const resolvedExamTypes = displayLookups?.examTypes ?? examTypes;
  const resolvedPolicyUsers = displayLookups?.users ?? policyUsers;
  const warnings = collectWarnings(snapshot, resolvedModalities, resolvedExamTypes, resolvedPolicyUsers);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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
    <div style={{ padding: 16, borderRadius: 8, border: "1px solid var(--border-color, #e2e8f0)", backgroundColor: "var(--bg-surface, #f8fafc)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Live Policy</h2>
        <button
          type="button"
          onClick={handleCopyJson}
          style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-color, #e2e8f0)", background: "var(--bg-card, #fff)", fontSize: 12, cursor: "pointer" }}
          title="Copy live policy snapshot as JSON"
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>

      {warnings.length > 0 && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 6, border: "1px solid #f59e0b", background: "#fffbeb", fontSize: 13 }}>
          <strong>Live policy warnings ({warnings.length})</strong>
          <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
            {warnings.slice(0, 6).map((warning, index) => (
              <li key={`${warning.kind}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <Section title="Daily category limits" count={snapshot.categoryDailyLimits.length} defaultOpen>
          {snapshot.categoryDailyLimits.length === 0 ? <EmptyMessage message="No daily category limits configured." /> : snapshot.categoryDailyLimits.map((row, index) => (
            <Card key={`${row.id}-${index}`}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                <Field label="Modality" value={formatModality(row.modalityId, resolvedModalities)} />
                <Field label="Category" value={row.caseCategory === "oncology" ? "Oncology" : "Non-oncology"} />
                <Field label="Daily limit" value={row.dailyLimit} />
                <Field label="Status" value={<Badge active={row.isActive} />} />
              </div>
            </Card>
          ))}
        </Section>

        <Section title="Blocked dates" count={snapshot.modalityBlockedRules.length}>
          {snapshot.modalityBlockedRules.length === 0 ? <EmptyMessage message="No blocked dates configured." /> : snapshot.modalityBlockedRules.map((row, index) => (
            <Card key={`${row.id}-${index}`}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                <Field label="Modality" value={formatModality(row.modalityId, resolvedModalities)} />
                <Field label="Rule type" value={formatRuleType(row.ruleType)} />
                <Field label="Schedule" value={formatSchedule(row)} />
                <Field label="Overridable" value={row.isOverridable ? "Yes" : "No"} />
                <Field label="Status" value={<Badge active={row.isActive} />} />
              </div>
            </Card>
          ))}
        </Section>

        <Section title="Exam restriction rules" count={snapshot.examTypeRules.length}>
          {snapshot.examTypeRules.length === 0 ? <EmptyMessage message="No exam restriction rules configured." /> : snapshot.examTypeRules.map((row, index) => (
            <Card key={`${row.id}-${index}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <strong>{row.title || `Exam restriction rule #${index + 1}`}</strong>
                <Badge active={row.isActive} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                <Field label="Modality" value={formatModality(row.modalityId, resolvedModalities)} />
                <Field label="Rule type" value={formatRuleType(row.ruleType)} />
                <Field label="Effect" value={formatEffectMode(row.effectMode)} />
                <Field label="Schedule" value={formatSchedule(row)} />
              </div>
              <ExamChips examTypeIds={row.examTypeIds} examTypes={resolvedExamTypes} />
            </Card>
          ))}
        </Section>

        <Section title="Exam mix quota groups" count={(snapshot.examMixQuotaRules ?? []).length}>
          {(snapshot.examMixQuotaRules ?? []).length === 0 ? <EmptyMessage message="No exam mix quota groups configured." /> : (snapshot.examMixQuotaRules ?? []).map((row, index) => (
            <Card key={`${row.id}-${index}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <strong>{row.title || `Exam mix group #${index + 1}`}</strong>
                <Badge active={row.isActive} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                <Field label="Modality" value={formatModality(row.modalityId, resolvedModalities)} />
                <Field label="Rule type" value={formatRuleType(row.ruleType)} />
                <Field label="Daily limit" value={row.dailyLimit} />
                <Field label="Schedule" value={formatSchedule(row)} />
              </div>
              <ExamChips examTypeIds={row.examTypeIds} examTypes={resolvedExamTypes} />
            </Card>
          ))}
        </Section>

        <Section title="Special quotas" count={snapshot.examTypeSpecialQuotas.length}>
          {snapshot.examTypeSpecialQuotas.length === 0 ? <EmptyMessage message="No special quotas configured." /> : snapshot.examTypeSpecialQuotas.map((row, index) => (
            <Card key={`${row.id}-${index}`}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                <Field label="Exam type" value={formatExamType(row.examTypeId, resolvedExamTypes)} />
                <Field label="Extra slots/day" value={row.dailyExtraSlots} />
                <Field label="Allowed users" value={formatAllowedUsers(row.allowedUserIds ?? [], resolvedPolicyUsers)} />
                <Field label="Status" value={<Badge active={row.isActive} />} />
              </div>
            </Card>
          ))}
        </Section>

        <Section title="Special reason codes" count={snapshot.specialReasonCodes.length}>
          {snapshot.specialReasonCodes.length === 0 ? <EmptyMessage message="No special reason codes configured." /> : snapshot.specialReasonCodes.map((row, index) => (
            <Card key={`${row.code}-${index}`}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                <Field label="Code" value={row.code} />
                <Field label="English" value={row.labelEn || "-"} />
                <Field label="Arabic" value={row.labelAr || "-"} />
                <Field label="Status" value={<Badge active={row.isActive} />} />
              </div>
            </Card>
          ))}
        </Section>
      </div>
    </div>
  );
}
