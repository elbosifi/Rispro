import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { Button, Input, EmptyState } from "@/components/shared";
import type { DoctorProfile, DoctorRosterMember } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import { DOCTOR_GRADES } from "./roster-board-utils";

export interface DoctorDragData {
  doctorId: number;
  label: string;
  assignmentId?: number;
  memberId?: number;
}
export function RosterDoctor({
  data,
  disabled,
  selected,
  onClick,
  detail,
}: {
  data: DoctorDragData;
  disabled: boolean;
  selected?: boolean;
  onClick?: () => void;
  detail?: string;
}) {
  const { t } = useLanguage();
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: data.memberId ? `member-${data.memberId}` : `doctor-${data.doctorId}`,
    data,
    disabled,
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className="flex min-h-10 w-full items-start gap-1 rounded-lg border px-2 py-2 text-start text-sm disabled:cursor-default"
      style={{
        borderColor: selected ? "var(--accent)" : "var(--border)",
        background: "var(--card)",
        opacity: isDragging ? 0.4 : 1,
      }}
      title={t("roster.dragDoctor")}
    >
      {!disabled && (
        <GripVertical
          size={14}
          className="mt-1 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <span className="min-w-0 break-words font-medium" dir="auto">
        {data.label}
        {detail && (
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </button>
  );
}
export function DoctorGroups({
  doctors,
  search,
  onSearch,
  selectedId,
  onSelect,
  disabled,
  indicators,
}: {
  doctors: DoctorProfile[];
  search: string;
  onSearch: (value: string) => void;
  selectedId?: number;
  onSelect: (doctor: DoctorProfile) => void;
  disabled: boolean;
  indicators: Map<number, string>;
}) {
  const { t } = useLanguage();
  const filtered = doctors.filter(
    (doctor) =>
      doctor.active &&
      `${doctor.displayName} ${doctor.fullName ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">
        {t("roster.searchDoctors")}
        <Input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t("roster.searchDoctors")}
        />
      </label>
      {DOCTOR_GRADES.map((grade) => {
        const rows = filtered.filter((doctor) => doctor.doctorRole === grade);
        return (
          <details
            key={grade}
            open
            className="rounded-lg border p-2"
            style={{ borderColor: "var(--border)" }}
          >
            <summary className="cursor-pointer py-1 text-sm font-semibold">
              {t(`roster.grade.${grade}`)}{" "}
              <span className="text-muted-foreground">({rows.length})</span>
            </summary>
            <div className="mt-2 space-y-2">
              {rows.map((doctor) => (
                <RosterDoctor
                  key={doctor.id}
                  data={{
                    doctorId: Number(doctor.id),
                    label: doctor.displayName,
                  }}
                  selected={Number(doctor.id) === selectedId}
                  disabled={disabled}
                  onClick={() => onSelect(doctor)}
                  detail={indicators.get(Number(doctor.id))}
                />
              ))}
            </div>
          </details>
        );
      })}
      {!filtered.length && <EmptyState message={t("roster.noDoctors")} />}
    </div>
  );
}
export function MemberRole({
  member,
  disabled,
  onChange,
}: {
  member: DoctorRosterMember;
  disabled: boolean;
  onChange: (role: DoctorRosterMember["teamRole"]) => void;
}) {
  const { t } = useLanguage();
  const roles = [
    "lead",
    "specialist",
    "sho",
    "supervisor",
    "observer",
  ] as const;
  return disabled ? (
    <p className="text-xs text-muted-foreground">
      {t(`roster.role.${member.teamRole}`)}
    </p>
  ) : (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="sr-only">
        {t("roster.responsibility", { name: member.displayName })}
      </span>
      <select
        className="min-w-0 max-w-full rounded border bg-transparent p-1"
        style={{ borderColor: "var(--border)" }}
        value={member.teamRole}
        onChange={(event) =>
          onChange(event.target.value as DoctorRosterMember["teamRole"])
        }
      >
        {roles.map((role) => (
          <option key={role} value={role}>
            {t(`roster.role.${role}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
export function DoctorPickerRows({
  doctors,
  members,
  onPick,
}: {
  doctors: DoctorProfile[];
  members: DoctorRosterMember[];
  onPick: (doctor: DoctorProfile) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="max-h-80 space-y-4 overflow-y-auto">
      {DOCTOR_GRADES.map((grade) => (
        <section key={grade}>
          <h4 className="mb-2 text-sm font-semibold">
            {t(`roster.grade.${grade}`)}
          </h4>
          {doctors
            .filter((row) => row.active && row.doctorRole === grade)
            .map((doctor) => (
              <Button
                key={doctor.id}
                variant="ghost"
                className="mb-1 h-auto min-h-10 w-full justify-start whitespace-normal text-start"
                disabled={members.some(
                  (row) => Number(row.doctorId) === Number(doctor.id),
                )}
                onClick={() => onPick(doctor)}
              >
                {doctor.displayName}
                {members.some(
                  (row) => Number(row.doctorId) === Number(doctor.id),
                ) && ` · ${t("roster.assigned")}`}
              </Button>
            ))}
        </section>
      ))}
    </div>
  );
}
