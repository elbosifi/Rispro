import { useDroppable } from "@dnd-kit/core";
import { Button, Badge } from "@/components/shared";
import type {
  DoctorRosterAssignment,
  DoctorRosterMember,
  RosterConflict,
} from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import type { TranslationKey } from "@/lib/i18n";
import {
  RosterDoctor,
  MemberRole,
  type DoctorDragData,
} from "./roster-doctors";

function useRosterConflictLabel() {
  const { t } = useLanguage();
  return (conflict: RosterConflict) =>
    t(`roster.conflict.${conflict.code}` as TranslationKey) ===
    `roster.conflict.${conflict.code}`
      ? t("roster.conflict.other")
      : t(`roster.conflict.${conflict.code}` as TranslationKey);
}
export function RosterSection({
  section,
  conflicts,
  editable,
  busy,
  dragging,
  selected,
  onAdd,
  onSettings,
  onRemove,
  onRemoveMember,
  onRole,
  onTransfer,
}: {
  section: DoctorRosterAssignment;
  conflicts: RosterConflict[];
  editable: boolean;
  busy: boolean;
  dragging: boolean;
  selected?: string;
  onAdd: () => void;
  onSettings: () => void;
  onRemove: () => void;
  onRemoveMember: (member: DoctorRosterMember) => void;
  onRole: (
    member: DoctorRosterMember,
    role: DoctorRosterMember["teamRole"],
  ) => void;
  onTransfer: (data: DoctorDragData) => void;
}) {
  const { t } = useLanguage();
  const conflictLabel = useRosterConflictLabel();
  const { isOver, setNodeRef } = useDroppable({
    id: `section-${section.id}`,
    data: { assignmentId: Number(section.id) },
    disabled: !editable || busy,
  });
  return (
    <article
      ref={setNodeRef}
      aria-label={section.teamName}
      data-testid={`roster-section-${section.id}`}
      className="min-w-0 space-y-3 rounded-xl border p-2 transition-colors"
      style={{
        borderColor: isOver || dragging ? "var(--accent)" : "var(--border)",
        borderStyle: dragging ? "dashed" : "solid",
        backgroundColor: isOver
          ? "color-mix(in srgb, var(--accent) 15%, var(--card))"
          : "var(--card)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-1">
        <h4 className="min-w-0 break-words font-semibold">
          {section.teamName}
        </h4>
        {editable && (
          <details className="relative text-xs">
            <summary
              className="cursor-pointer rounded p-1"
              aria-label={t("roster.sectionActions", {
                name: section.teamName,
              })}
            >
              •••
            </summary>
            <div
              className="absolute end-0 z-10 min-w-32 space-y-1 rounded-lg border p-2 shadow-lg"
              style={{
                background: "var(--card)",
                borderColor: "var(--border)",
              }}
            >
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onSettings}
              >
                {t("roster.settings")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onRemove}
              >
                {t("roster.removeSection")}
              </Button>
            </div>
          </details>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {section.sessionName && <span>{section.sessionName} · </span>}
        <bdi>
          {section.startTime?.slice(0, 5) || "—"} –{" "}
          {section.endTime?.slice(0, 5) || "—"}
        </bdi>
      </p>
      <div className="space-y-2">
        {section.members.map((member) => {
          const data = {
            doctorId: Number(member.doctorId),
            memberId: Number(member.id),
            assignmentId: Number(section.id),
            label: member.displayName,
          };
          return (
            <div key={member.id} className="min-w-0 space-y-1">
              <RosterDoctor data={data} disabled={!editable || busy} />
              <MemberRole
                member={member}
                disabled={!editable || busy}
                onChange={(role) => onRole(member, role)}
              />
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    disabled={busy}
                    onClick={() => onTransfer(data)}
                  >
                    {t("roster.moveCopy")}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    disabled={busy}
                    onClick={() => onRemoveMember(member)}
                  >
                    {t("roster.removeDoctor")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {editable && (
        <Button
          size="sm"
          variant="secondary"
          className="h-auto min-h-9 w-full whitespace-normal px-2"
          disabled={busy}
          onClick={onAdd}
        >
          {selected
            ? t("roster.assignSelected", { name: selected })
            : t("roster.addDoctor")}
        </Button>
      )}
      {!section.members.length && (
        <p className="text-xs text-muted-foreground">
          {t(editable ? "roster.dropHere" : "roster.noAssigned")}
        </p>
      )}
      {conflicts.length > 0 && (
        <div
          role="status"
          className="space-y-2 border-t pt-2"
          style={{ borderColor: "var(--border)" }}
        >
          {conflicts.map((conflict, index) => (
            <p
              key={`${conflict.code}-${index}`}
              className="break-words text-xs"
            >
              <Badge
                variant={conflict.severity === "error" ? "error" : "warning"}
                size="sm"
              >
                {t(
                  conflict.severity === "error"
                    ? "roster.needsAttention"
                    : "roster.warning",
                )}
              </Badge>
              <span className="mt-1 block">
                {conflict.doctorId &&
                section.members.some(
                  (member) =>
                    Number(member.doctorId) === Number(conflict.doctorId),
                )
                  ? `${section.members.find((member) => Number(member.doctorId) === Number(conflict.doctorId))?.displayName ?? ""}: `
                  : ""}
                {conflictLabel(conflict)}
              </span>
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
