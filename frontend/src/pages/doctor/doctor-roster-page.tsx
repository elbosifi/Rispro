import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import {
  addDoctorRosterMember,
  applyRosterTemplate,
  confirmRosterXmlImport,
  copyPreviousDoctorRosterWeek,
  createRosterTemplate,
  createDoctorRosterAssignment,
  createDoctorRosterWeek,
  deleteDoctorRosterAssignment,
  deleteDoctorRosterMember,
  fetchAppointmentLookups,
  fetchDoctorRosterWeek,
  fetchMyDoctorRoster,
  fetchRosterDoctors,
  fetchRosterDutyTypes,
  fetchRosterShiftImportMappings,
  fetchRosterTemplates,
  fetchRosterWeekConflicts,
  generateDoctorRosterDraft,
  notifyDoctorRosterWeek,
  previewRosterXmlImport,
  publishDoctorRosterWeek,
  saveRosterDutyType,
  saveRosterShiftImportMapping,
} from "@/lib/api-hooks";
import type { ApplyRosterTemplateResult, GenerateDraftRosterResult, RosterBalanceStrategy, RosterNotificationSummary, RosterXmlImportPreview, RosterXmlImportResult, DoctorMe, DoctorRosterAssignment, RosterConflict, RosterDutyType, RosterTeamRole, RosterTemplateCopyMode, RosterTemplateType } from "@/types/api";

const TEAM_ROLES: Array<{ value: RosterTeamRole; label: string }> = [
  { value: "lead", label: "Lead" },
  { value: "specialist", label: "Specialist" },
  { value: "sho", label: "SHO" },
  { value: "supervisor", label: "Supervisor" },
  { value: "observer", label: "Observer" },
];

const TEMPLATE_TYPES: Array<{ value: RosterTemplateType; label: string }> = [
  { value: "ct_weekly", label: "CT weekly" },
  { value: "mri_weekly", label: "MRI weekly" },
  { value: "ultrasound_weekly", label: "Ultrasound weekly" },
  { value: "mammography_weekly", label: "Mammography weekly" },
  { value: "mixed_weekly", label: "Mixed weekly" },
  { value: "custom", label: "Custom" },
];

function weekStartIso(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isManager(me: DoctorMe): boolean {
  return me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
}

function isAdmin(me: DoctorMe): boolean {
  return me.moduleCapabilities.includes("doctor_admin");
}

function dutyLabel(value: string, dutyTypeLabels = new Map<string, string>()): string {
  return dutyTypeLabels.get(value) ?? value.replaceAll("_", " ");
}

function rosterStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}

function statusColor(status: string): string {
  if (status === "draft") return "#0f766e";
  if (status === "published") return "#2563eb";
  if (status === "archived") return "#6b7280";
  return "var(--text-muted)";
}

function RosterStatePanel({
  title,
  body,
  tone = "info",
  children,
}: {
  title: string;
  body: string;
  tone?: "info" | "warning";
  children?: ReactNode;
}) {
  return (
    <section
      className="rounded-lg border p-4"
      style={{
        backgroundColor: tone === "warning" ? "#fffbeb" : "var(--card)",
        borderColor: tone === "warning" ? "#f59e0b" : "var(--border)",
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm leading-5" style={{ color: tone === "warning" ? "#92400e" : "var(--text-muted)" }}>
        {body}
      </p>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </section>
  );
}

function SecondaryLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
      {children}
    </Link>
  );
}

function DraggableDoctor({
  id,
  label,
  dimmed,
  reason,
  source,
}: {
  id: number;
  label: string;
  dimmed?: boolean;
  reason?: string;
  source?: { assignmentId: number; memberId: number };
}) {
  const draggable = useDraggable({ id: source ? `member-${source.memberId}` : `doctor-${id}`, data: { doctorId: id, source } });
  return (
    <button
      ref={draggable.setNodeRef}
      type="button"
      {...draggable.listeners}
      {...draggable.attributes}
      className="rounded-lg border px-3 py-2 text-left text-xs"
      style={{
        borderColor: "var(--border)",
        opacity: dimmed ? 0.55 : 1,
        transform: draggable.transform ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)` : undefined,
      }}
      title={reason}
    >
      <span className="font-semibold">{label}</span>
      {reason && <span className="block" style={{ color: "var(--text-muted)" }}>{reason}</span>}
    </button>
  );
}

function DroppableRosterSlot({ assignment, conflicts, dutyTypeLabels }: { assignment: DoctorRosterAssignment; conflicts: RosterConflict[]; dutyTypeLabels: Map<string, string> }) {
  const droppable = useDroppable({ id: `assignment-${assignment.id}`, data: { assignmentId: assignment.id } });
  const assignmentConflicts = conflicts.filter((conflict) => conflict.assignmentId === assignment.id);
  return (
    <div ref={droppable.setNodeRef} className="min-h-36 rounded-lg border p-3" style={{ borderColor: droppable.isOver ? "var(--accent)" : "var(--border)", backgroundColor: "var(--card)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{assignment.teamName}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{assignment.date} · {assignment.modalityNameEn ?? "No modality"} · {dutyLabel(assignment.dutyType, dutyTypeLabels)}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{assignment.startTime || "--"}-{assignment.endTime || "--"}</p>
        </div>
        {assignmentConflicts.length > 0 && <span className="rounded-full border px-2 py-0.5 text-xs text-red-600" style={{ borderColor: "var(--border)" }}>{assignmentConflicts.length} conflicts</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {assignment.members.length === 0 && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Drop doctor here</span>}
        {assignment.members.map((member) => (
          <DraggableDoctor key={member.id} id={member.doctorId} label={`${member.displayName} · ${member.teamRole}`} source={{ assignmentId: assignment.id, memberId: member.id }} />
        ))}
      </div>
    </div>
  );
}

function AssignmentList({
  assignments,
  canManage,
  onDeleteAssignment,
  onRemoveMember,
  conflicts,
  dutyTypeLabels,
}: {
  assignments: DoctorRosterAssignment[];
  canManage: boolean;
  onDeleteAssignment?: (assignmentId: number) => void;
  onRemoveMember?: (assignmentId: number, memberId: number) => void;
  conflicts?: RosterConflict[];
  dutyTypeLabels: Map<string, string>;
}) {
  if (assignments.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        No roster assignments for this week.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assignments.map((assignment) => (
        <article key={assignment.id} className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          {(conflicts ?? []).filter((conflict) => conflict.assignmentId === assignment.id).map((conflict, index) => (
            <p key={`${conflict.code}-${index}`} className="mb-2 rounded-lg border px-3 py-2 text-xs font-medium" style={{ borderColor: "var(--border)", color: conflict.severity === "error" ? "#dc2626" : "var(--text-muted)" }}>
              {conflict.severity.toUpperCase()}: {conflict.message}
            </p>
          ))}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{assignment.teamName}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {assignment.date} · {assignment.modalityNameEn ?? "No modality"} · {dutyLabel(assignment.dutyType, dutyTypeLabels)}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {assignment.sessionName || "No session"} · {assignment.startTime || "--"}-{assignment.endTime || "--"}
              </p>
            </div>
            {canManage && onDeleteAssignment && (
              <button
                type="button"
                onClick={() => onDeleteAssignment(assignment.id)}
                className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--border)" }}
              >
                Delete
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {assignment.members.length === 0 ? (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>No team members</span>
            ) : (
              assignment.members.map((member) => (
                <span key={member.id} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                  {member.displayName} · {member.teamRole}
                  {canManage && onRemoveMember && (
                    <button type="button" onClick={() => onRemoveMember(assignment.id, member.id)} aria-label={`Remove ${member.displayName}`}>
                      ×
                    </button>
                  )}
                </span>
              ))
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

export function DoctorRosterPage({ me, management = false, advanced = false }: { me: DoctorMe; management?: boolean; advanced?: boolean }) {
  const queryClient = useQueryClient();
  const canManage = management && isManager(me);
  const canManageTemplates = canManage && isAdmin(me);
  const showAdvancedRosterTools = canManage && advanced;
  const showAdminRosterSetup = canManageTemplates && advanced;
  const [weekStart, setWeekStart] = useState(weekStartIso());
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const rosterQueryKey = canManage ? ["doctor", "roster", "week", weekStart] : ["doctor", "roster", "my", weekStart];

  const rosterQuery = useQuery({
    queryKey: rosterQueryKey,
    queryFn: () => (canManage ? fetchDoctorRosterWeek(weekStart) : fetchMyDoctorRoster(weekStart)),
  });

  const lookupsQuery = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    enabled: canManage,
    staleTime: 1000 * 60 * 5,
  });

  const doctorsQuery = useQuery({
    queryKey: ["doctor", "roster", "doctors"],
    queryFn: fetchRosterDoctors,
    enabled: canManage,
  });
  const templatesQuery = useQuery({
    queryKey: ["doctor", "roster", "templates"],
    queryFn: fetchRosterTemplates,
    enabled: showAdvancedRosterTools,
  });
  const dutyTypesQuery = useQuery({
    queryKey: ["doctor", "roster", "duty-types"],
    queryFn: () => fetchRosterDutyTypes(true),
    enabled: canManage,
  });
  const shiftMappingsQuery = useQuery({
    queryKey: ["doctor", "roster", "shift-import-mappings"],
    queryFn: () => fetchRosterShiftImportMappings(true),
    enabled: showAdminRosterSetup,
  });
  const activeDutyTypes = useMemo(
    () => (dutyTypesQuery.data ?? []).filter((dutyType) => dutyType.active),
    [dutyTypesQuery.data]
  );
  const dutyTypeLabels = useMemo(
    () => new Map((dutyTypesQuery.data ?? []).map((dutyType) => [dutyType.code, dutyType.label])),
    [dutyTypesQuery.data]
  );

  const invalidateRoster = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "roster"] });
  };

  const createWeekMutation = useMutation({
    mutationFn: () => createDoctorRosterWeek({ weekStartDate: weekStart, weekEndDate: weekEnd }),
    onSuccess: invalidateRoster,
  });
  const copyMutation = useMutation({
    mutationFn: (weekId: number) => copyPreviousDoctorRosterWeek(weekId),
    onSuccess: invalidateRoster,
  });
  const publishMutation = useMutation({
    mutationFn: (weekId: number) => publishDoctorRosterWeek(weekId),
    onSuccess: invalidateRoster,
  });
  const assignmentMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createDoctorRosterAssignment>[0]) => createDoctorRosterAssignment(payload),
    onSuccess: invalidateRoster,
  });
  const deleteAssignmentMutation = useMutation({
    mutationFn: deleteDoctorRosterAssignment,
    onSuccess: invalidateRoster,
  });
  const addMemberMutation = useMutation({
    mutationFn: (payload: { assignmentId: number; doctorId: number; teamRole: RosterTeamRole }) =>
      addDoctorRosterMember(payload.assignmentId, { doctorId: payload.doctorId, teamRole: payload.teamRole }),
    onSuccess: invalidateRoster,
  });
  const removeMemberMutation = useMutation({
    mutationFn: (payload: { assignmentId: number; memberId: number }) =>
      deleteDoctorRosterMember(payload.assignmentId, payload.memberId),
    onSuccess: invalidateRoster,
  });
  const createTemplateMutation = useMutation({
    mutationFn: createRosterTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["doctor", "roster", "templates"] });
    },
  });
  const [templateApplyResult, setTemplateApplyResult] = useState<ApplyRosterTemplateResult | null>(null);
  const [generateResult, setGenerateResult] = useState<GenerateDraftRosterResult | null>(null);
  const [notifyResult, setNotifyResult] = useState<RosterNotificationSummary | null>(null);
  const [xmlImportPreview, setXmlImportPreview] = useState<RosterXmlImportPreview | null>(null);
  const [xmlImportResult, setXmlImportResult] = useState<RosterXmlImportResult | null>(null);
  const applyTemplateMutation = useMutation({
    mutationFn: (payload: { templateId: number; targetWeekStartDate: string; copyMode: RosterTemplateCopyMode; overwriteExisting: boolean; modalityId: number | null }) =>
      applyRosterTemplate(payload.templateId, payload),
    onSuccess: async (result) => {
      setTemplateApplyResult(result);
      await invalidateRoster();
    },
  });
  const generateMutation = useMutation({
    mutationFn: (payload: { weekStartDate: string; templateId: number | null; modalityId: number | null; includeDoctors: boolean; balanceStrategy: RosterBalanceStrategy }) =>
      generateDoctorRosterDraft(payload),
    onSuccess: async (result) => {
      setGenerateResult(result);
      await invalidateRoster();
    },
  });
  const notifyMutation = useMutation({
    mutationFn: notifyDoctorRosterWeek,
    onSuccess: (result) => setNotifyResult(result),
  });
  const saveDutyTypeMutation = useMutation({
    mutationFn: saveRosterDutyType,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["doctor", "roster", "duty-types"] });
    },
  });
  const saveShiftMappingMutation = useMutation({
    mutationFn: saveRosterShiftImportMapping,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["doctor", "roster", "shift-import-mappings"] });
    },
  });
  const previewXmlImportMutation = useMutation({
    mutationFn: previewRosterXmlImport,
    onSuccess: (preview) => {
      setXmlImportPreview(preview);
      setXmlImportResult(null);
    },
  });
  const confirmXmlImportMutation = useMutation({
    mutationFn: confirmRosterXmlImport,
    onSuccess: async (result) => {
      setXmlImportResult(result);
      await queryClient.invalidateQueries({ queryKey: ["doctor", "roster"] });
    },
  });

  const [assignmentForm, setAssignmentForm] = useState({
    date: weekStart,
    modalityId: "",
    dutyType: "" as RosterDutyType,
    sessionName: "",
    startTime: "08:00",
    endTime: "14:00",
    teamName: "",
  });
  const [memberForm, setMemberForm] = useState({ assignmentId: "", doctorId: "", teamRole: "specialist" as RosterTeamRole });
  const [templateForm, setTemplateForm] = useState({
    name: "",
    templateType: "ct_weekly" as RosterTemplateType,
    dayOfWeek: "1",
    dutyType: "" as RosterDutyType,
    teamName: "Template team",
    placeholderLabel: "Lead specialist",
    requiredRole: "specialist",
  });
  const [templateApplyForm, setTemplateApplyForm] = useState({
    templateId: "",
    copyMode: "structure_only" as RosterTemplateCopyMode,
    overwriteExisting: false,
  });
  const [generateForm, setGenerateForm] = useState({
    templateId: "",
    includeDoctors: false,
    balanceStrategy: "simple" as RosterBalanceStrategy,
  });
  const [dutyTypeDraft, setDutyTypeDraft] = useState({
    code: "",
    label: "",
    active: true,
    requiresSpecialist: false,
    sortOrder: 0,
  });
  const [shiftMappingDraft, setShiftMappingDraft] = useState({
    sourceSystem: "abc",
    sourceShiftName: "",
    sourceShiftType: "",
    sourceShiftAbbreviation: "",
    dutyTypeCode: "",
    modalityId: "",
    teamName: "",
    active: true,
  });
  const [xmlImportDraft, setXmlImportDraft] = useState({
    fileContentBase64: "",
    temporaryPassword: "",
    defaultDoctorRole: "consultant",
    defaultCoreRole: "doctor" as "doctor" | "supervisor",
    defaultTeamRole: "specialist",
    createMissingDoctors: true,
  });
  useEffect(() => {
    const firstTemplate = templatesQuery.data?.[0];
    if (firstTemplate && !templateApplyForm.templateId) {
      setTemplateApplyForm((current) => ({ ...current, templateId: String(firstTemplate.id) }));
    }
  }, [templatesQuery.data, templateApplyForm.templateId]);
  useEffect(() => {
    const firstDutyType = activeDutyTypes[0]?.code ?? "";
    if (!firstDutyType) return;
    setAssignmentForm((current) => (current.dutyType ? current : { ...current, dutyType: firstDutyType }));
    setTemplateForm((current) => (current.dutyType ? current : { ...current, dutyType: firstDutyType }));
    setShiftMappingDraft((current) => (current.dutyTypeCode ? current : { ...current, dutyTypeCode: firstDutyType }));
  }, [activeDutyTypes]);

  const roster = rosterQuery.data;
  const editable = canManage && roster?.week?.status === "draft";
  const assignments = roster?.assignments ?? [];
  const isEmptyRoster = assignments.length === 0;
  const hasNoWeek = canManage && !roster?.week;
  const isEmptyDraft = canManage && roster?.week?.status === "draft" && isEmptyRoster;
  const isEmptyPublished = canManage && roster?.week?.status === "published" && isEmptyRoster;
  const isPublishedWithAssignments = canManage && roster?.week?.status === "published" && !isEmptyRoster;
  const conflictsQuery = useQuery({
    queryKey: ["doctor", "roster", "conflicts", roster?.week?.id],
    queryFn: () => fetchRosterWeekConflicts(roster!.week!.id),
    enabled: Boolean(canManage && roster?.week),
  });
  const conflicts = conflictsQuery.data ?? [];
  const selectedAssignmentId = memberForm.assignmentId ? Number(memberForm.assignmentId) : null;
  const conflictedDoctorIds = new Set(
    conflicts
      .filter((conflict) => !selectedAssignmentId || conflict.assignmentId === selectedAssignmentId)
      .map((conflict) => conflict.doctorId)
      .filter((doctorId): doctorId is number => typeof doctorId === "number")
  );
  const conflictReasonByDoctorId = new Map<number, string>();
  for (const conflict of conflicts) {
    if (typeof conflict.doctorId === "number" && !conflictReasonByDoctorId.has(conflict.doctorId)) {
      conflictReasonByDoctorId.set(conflict.doctorId, conflict.message);
    }
  }
  const handleDragEnd = (event: DragEndEvent) => {
    const assignmentId = Number(event.over?.data.current?.assignmentId);
    const doctorId = Number(event.active.data.current?.doctorId);
    const source = event.active.data.current?.source as { assignmentId: number; memberId: number } | undefined;
    if (!assignmentId || !doctorId || !editable) return;
    if (source?.assignmentId === assignmentId) return;
    const shouldMove = source ? window.confirm("Move this doctor to the target slot? Choose Cancel to copy instead.") : false;
    addMemberMutation.mutate(
      { assignmentId, doctorId, teamRole: "specialist" },
      {
        onSuccess: () => {
          if (shouldMove && source) {
            removeMemberMutation.mutate({ assignmentId: source.assignmentId, memberId: source.memberId });
          }
        },
      }
    );
  };
  const selectWeek = (nextWeekStart: string) => {
    setWeekStart(nextWeekStart);
    setAssignmentForm((current) => ({ ...current, date: nextWeekStart }));
  };
  const goToCurrentWeek = () => selectWeek(weekStartIso());
  const goToPreviousWeek = () => selectWeek(addDays(weekStart, -7));
  const goToNextWeek = () => selectWeek(addDays(weekStart, 7));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
            {canManage ? "Roster Management" : "My Roster"}
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">{weekStart} to {weekEnd}</h2>
        </div>
        <label className="text-sm font-medium">
          Week start
          <input
            type="date"
            value={weekStart}
            onChange={(event) => selectWeek(event.target.value)}
            className="mt-1 block rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={goToPreviousWeek} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
          Previous week
        </button>
        <button type="button" onClick={goToCurrentWeek} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
          Current week
        </button>
        <button type="button" onClick={goToNextWeek} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
          Next week
        </button>
      </div>

      {canManage && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2">
            {!roster?.week && (
              <button type="button" onClick={() => createWeekMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
                Create draft week
              </button>
            )}
            {roster?.week && (
              <>
                <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: statusColor(roster.week.status), color: statusColor(roster.week.status) }}>
                  {rosterStatusLabel(roster.week.status)}
                </span>
                {editable && (
                  <>
                    <button type="button" onClick={() => copyMutation.mutate(roster.week!.id)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                      Copy previous week
                    </button>
                    <button type="button" onClick={() => publishMutation.mutate(roster.week!.id)} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
                      Publish week
                    </button>
                  </>
                )}
                {advanced && roster.week.status === "published" && (
                  <button type="button" onClick={() => notifyMutation.mutate(roster.week!.id)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                    Notify assigned doctors
                  </button>
                )}
                {advanced && (
                  <>
                    <a href={`/api/doctor/roster/weeks/${roster.week.id}/export?format=html&scope=${canManage ? "full" : "my"}`} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                      Export HTML
                    </a>
                    <a href={`/api/doctor/roster/weeks/${roster.week.id}/export?format=csv&scope=${canManage ? "full" : "my"}`} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
                      Export CSV
                    </a>
                  </>
                )}
              </>
            )}
          </div>
          {publishMutation.isError && (
            <p className="mt-3 text-sm font-medium" style={{ color: "#dc2626" }}>
              Publish blocked: roster has publish-blocking conflicts.
            </p>
          )}
          {advanced && notifyResult && (
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
              Notification records: {notifyResult.createdCount} created, {notifyResult.alreadyExistingCount} already existed.
            </p>
          )}
        </section>
      )}

      {hasNoWeek && (
        <RosterStatePanel
          title="No roster week exists for selected week."
          body="Create a draft roster week before adding shifts and assigning doctors."
        >
          <button type="button" onClick={() => createWeekMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
            Create draft week
          </button>
        </RosterStatePanel>
      )}

      {isEmptyDraft && roster?.week && (
        <RosterStatePanel
          title="Draft roster is empty."
          body="Add an assignment below, copy the previous week, or use Advanced Setup for templates, XML import, and draft generation."
        >
          <button type="button" onClick={() => copyMutation.mutate(roster.week!.id)} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            Copy previous week
          </button>
          {!advanced && <SecondaryLink to="/doctor/advanced-setup">Open Advanced Setup</SecondaryLink>}
        </RosterStatePanel>
      )}

      {isEmptyPublished && (
        <RosterStatePanel
          title="This roster week is published but has no assignments. Published weeks are read-only."
          body="Choose another week to continue roster planning, or open Advanced Setup for low-frequency roster tools."
          tone="warning"
        >
          {!advanced && <SecondaryLink to="/doctor/advanced-setup">Open Advanced Setup</SecondaryLink>}
          <button type="button" onClick={goToPreviousWeek} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            Previous week
          </button>
          <button type="button" onClick={goToNextWeek} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            Next week
          </button>
        </RosterStatePanel>
      )}

      {isPublishedWithAssignments && !advanced && (
        <RosterStatePanel
          title="Published roster is read-only."
          body="Review assigned shifts below. Use another draft week for edits, or open Advanced Setup for exports and notifications."
        >
          <SecondaryLink to="/doctor/advanced-setup">Open Advanced Setup</SecondaryLink>
        </RosterStatePanel>
      )}

      {showAdminRosterSetup && (
        <section className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <div className="space-y-3">
            <h3 className="font-semibold">Roster duty types</h3>
            <form
              className="grid gap-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!dutyTypeDraft.code.trim() || !dutyTypeDraft.label.trim()) return;
                saveDutyTypeMutation.mutate({
                  code: dutyTypeDraft.code,
                  label: dutyTypeDraft.label,
                  active: dutyTypeDraft.active,
                  requiresSpecialist: dutyTypeDraft.requiresSpecialist,
                  sortOrder: Number(dutyTypeDraft.sortOrder) || 0,
                });
              }}
            >
              <input placeholder="Code" value={dutyTypeDraft.code} onChange={(e) => setDutyTypeDraft((c) => ({ ...c, code: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <input placeholder="Label" value={dutyTypeDraft.label} onChange={(e) => setDutyTypeDraft((c) => ({ ...c, label: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <input type="number" placeholder="Sort order" value={dutyTypeDraft.sortOrder} onChange={(e) => setDutyTypeDraft((c) => ({ ...c, sortOrder: Number(e.target.value) }))} className="rounded-lg border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dutyTypeDraft.active} onChange={(e) => setDutyTypeDraft((c) => ({ ...c, active: e.target.checked }))} /> Active</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dutyTypeDraft.requiresSpecialist} onChange={(e) => setDutyTypeDraft((c) => ({ ...c, requiresSpecialist: e.target.checked }))} /> Requires specialist</label>
              <button type="submit" disabled={!dutyTypeDraft.code.trim() || !dutyTypeDraft.label.trim() || saveDutyTypeMutation.isPending} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">Save duty type</button>
            </form>
            <div className="space-y-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {(dutyTypesQuery.data ?? []).map((dutyType) => (
                <button
                  key={dutyType.code}
                  type="button"
                  className="block text-left"
                  onClick={() => setDutyTypeDraft({
                    code: dutyType.code,
                    label: dutyType.label,
                    active: dutyType.active,
                    requiresSpecialist: dutyType.requiresSpecialist,
                    sortOrder: dutyType.sortOrder,
                  })}
                >
                  {dutyType.label} ({dutyType.code}){dutyType.active ? "" : " inactive"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold">ABC shift mappings</h3>
            <form
              className="grid gap-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!shiftMappingDraft.dutyTypeCode) return;
                saveShiftMappingMutation.mutate({
                  sourceSystem: shiftMappingDraft.sourceSystem || "abc",
                  sourceShiftName: shiftMappingDraft.sourceShiftName || null,
                  sourceShiftType: shiftMappingDraft.sourceShiftType || null,
                  sourceShiftAbbreviation: shiftMappingDraft.sourceShiftAbbreviation || null,
                  dutyTypeCode: shiftMappingDraft.dutyTypeCode,
                  modalityId: shiftMappingDraft.modalityId ? Number(shiftMappingDraft.modalityId) : null,
                  teamName: shiftMappingDraft.teamName || null,
                  active: shiftMappingDraft.active,
                });
              }}
            >
              <input placeholder="Shift name" value={shiftMappingDraft.sourceShiftName} onChange={(e) => setShiftMappingDraft((c) => ({ ...c, sourceShiftName: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <input placeholder="Shift type" value={shiftMappingDraft.sourceShiftType} onChange={(e) => setShiftMappingDraft((c) => ({ ...c, sourceShiftType: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <input placeholder="Abbreviation" value={shiftMappingDraft.sourceShiftAbbreviation} onChange={(e) => setShiftMappingDraft((c) => ({ ...c, sourceShiftAbbreviation: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <select value={shiftMappingDraft.dutyTypeCode} onChange={(e) => setShiftMappingDraft((c) => ({ ...c, dutyTypeCode: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">Duty type</option>
                {activeDutyTypes.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
              </select>
              <select value={shiftMappingDraft.modalityId} onChange={(e) => setShiftMappingDraft((c) => ({ ...c, modalityId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">No modality</option>
                {(lookupsQuery.data?.modalities ?? []).map((modality) => <option key={modality.id} value={modality.id}>{modality.nameEn}</option>)}
              </select>
              <input placeholder="Team name" value={shiftMappingDraft.teamName} onChange={(e) => setShiftMappingDraft((c) => ({ ...c, teamName: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shiftMappingDraft.active} onChange={(e) => setShiftMappingDraft((c) => ({ ...c, active: e.target.checked }))} /> Active</label>
              <button type="submit" disabled={!shiftMappingDraft.dutyTypeCode || saveShiftMappingMutation.isPending} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">Save mapping</button>
            </form>
            <div className="space-y-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {(shiftMappingsQuery.data ?? []).map((mapping) => (
                <p key={mapping.id}>{mapping.sourceShiftName || mapping.sourceShiftType || mapping.sourceShiftAbbreviation || "Unnamed shift"} {">"} {dutyLabel(mapping.dutyTypeCode, dutyTypeLabels)}</p>
              ))}
            </div>
          </div>
        </section>
      )}

      {showAdminRosterSetup && (
        <section className="space-y-3 rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="font-semibold">Import roster from ABC export</h3>
          <div className="grid gap-2 md:grid-cols-6">
            <input
              type="file"
              accept=".xml,text/xml,application/xml"
              className="rounded-lg border px-3 py-2 text-sm md:col-span-2"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const content = String(reader.result ?? "");
                  setXmlImportDraft((current) => ({ ...current, fileContentBase64: content.split(",")[1] ?? "" }));
                };
                reader.readAsDataURL(file);
              }}
            />
            <select value={xmlImportDraft.defaultDoctorRole} onChange={(event) => setXmlImportDraft((current) => ({ ...current, defaultDoctorRole: event.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
              <option value="consultant">Consultant</option>
              <option value="specialist">Specialist</option>
              <option value="senior_house_officer">Senior house officer</option>
              <option value="resident">Resident</option>
            </select>
            <select value={xmlImportDraft.defaultCoreRole} onChange={(event) => setXmlImportDraft((current) => ({ ...current, defaultCoreRole: event.target.value as "doctor" | "supervisor" }))} className="rounded-lg border px-3 py-2 text-sm">
              <option value="doctor">RISpro doctor user</option>
              <option value="supervisor">RISpro supervisor user</option>
            </select>
            <select value={xmlImportDraft.defaultTeamRole} onChange={(event) => setXmlImportDraft((current) => ({ ...current, defaultTeamRole: event.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
              {TEAM_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
            <input type="password" placeholder="Temporary password" value={xmlImportDraft.temporaryPassword} onChange={(event) => setXmlImportDraft((current) => ({ ...current, temporaryPassword: event.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={xmlImportDraft.createMissingDoctors} onChange={(event) => setXmlImportDraft((current) => ({ ...current, createMissingDoctors: event.target.checked }))} />
            Create RISpro users and doctor profiles for unmatched doctors
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!xmlImportDraft.fileContentBase64 || previewXmlImportMutation.isPending} onClick={() => previewXmlImportMutation.mutate({ fileContentBase64: xmlImportDraft.fileContentBase64 })} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>Preview XML</button>
            <button type="button" disabled={!xmlImportPreview?.canConfirm || !xmlImportDraft.temporaryPassword || confirmXmlImportMutation.isPending} onClick={() => confirmXmlImportMutation.mutate(xmlImportDraft)} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">Confirm import</button>
          </div>
          {xmlImportPreview && (
            <div className="grid gap-3 text-sm md:grid-cols-4">
              <p>Matched doctors: {xmlImportPreview.doctorsMatched.length}</p>
              <p>Doctors to create: {xmlImportPreview.doctorsToCreate.length}</p>
              <p>Duty slots: {xmlImportPreview.dutySlotsToCreate.length}</p>
              <p>Unmapped shifts: {xmlImportPreview.unmappedShiftTypes.length}</p>
              {xmlImportPreview.warnings.map((warning) => <p key={warning} className="md:col-span-4 text-amber-700">{warning}</p>)}
            </div>
          )}
          {xmlImportResult && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{xmlImportResult.message} Created doctors: {xmlImportResult.createdDoctors.length}.</p>}
        </section>
      )}

      {canManage && conflicts.length > 0 && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="font-semibold">Roster conflicts</h3>
          <div className="mt-3 space-y-2 text-sm">
            {conflicts.map((conflict, index) => (
              <p key={`${conflict.code}-${index}`} style={{ color: conflict.severity === "error" ? "#dc2626" : "var(--text-muted)" }}>
                {conflict.severity.toUpperCase()}: {conflict.message}
              </p>
            ))}
          </div>
        </section>
      )}

      {canManage && editable && (
        <DndContext onDragEnd={handleDragEnd}>
          <section className="grid gap-4 rounded-lg border p-4 lg:grid-cols-[260px_1fr]" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
            <div>
              <h3 className="font-semibold">Doctors</h3>
              <div className="mt-3 grid gap-2">
                {(doctorsQuery.data ?? []).map((doctor) => (
                  <DraggableDoctor
                    key={doctor.id}
                    id={doctor.id}
                    label={doctor.displayName}
                    dimmed={conflictedDoctorIds.has(doctor.id)}
                    reason={conflictReasonByDoctorId.get(doctor.id)}
                  />
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Roster slots</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(roster?.assignments ?? []).map((assignment) => (
                  <DroppableRosterSlot key={assignment.id} assignment={assignment} conflicts={conflicts} dutyTypeLabels={dutyTypeLabels} />
                ))}
              </div>
            </div>
          </section>
        </DndContext>
      )}

      {canManage && editable && (
        <section className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!roster?.week || !assignmentForm.dutyType) return;
              assignmentMutation.mutate({
                rosterWeekId: roster.week.id,
                date: assignmentForm.date,
                modalityId: assignmentForm.modalityId ? Number(assignmentForm.modalityId) : null,
                dutyType: assignmentForm.dutyType,
                sessionName: assignmentForm.sessionName || null,
                startTime: assignmentForm.startTime || null,
                endTime: assignmentForm.endTime || null,
                teamName: assignmentForm.teamName || "Rostered team",
              });
            }}
          >
            <h3 className="font-semibold">Add assignment</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input type="date" value={assignmentForm.date} onChange={(e) => setAssignmentForm((c) => ({ ...c, date: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <select value={assignmentForm.modalityId} onChange={(e) => setAssignmentForm((c) => ({ ...c, modalityId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">No modality</option>
                {(lookupsQuery.data?.modalities ?? []).map((modality) => (
                  <option key={modality.id} value={modality.id}>{modality.nameEn}</option>
                ))}
              </select>
              <select value={assignmentForm.dutyType} onChange={(e) => setAssignmentForm((c) => ({ ...c, dutyType: e.target.value as RosterDutyType }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">Duty type</option>
                {activeDutyTypes.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
              </select>
              <input placeholder="Team name" value={assignmentForm.teamName} onChange={(e) => setAssignmentForm((c) => ({ ...c, teamName: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <input placeholder="Session" value={assignmentForm.sessionName} onChange={(e) => setAssignmentForm((c) => ({ ...c, sessionName: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="time" value={assignmentForm.startTime} onChange={(e) => setAssignmentForm((c) => ({ ...c, startTime: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
                <input type="time" value={assignmentForm.endTime} onChange={(e) => setAssignmentForm((c) => ({ ...c, endTime: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              </div>
            </div>
            <button type="submit" disabled={!assignmentForm.dutyType || activeDutyTypes.length === 0} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">Add assignment</button>
          </form>

          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!memberForm.assignmentId || !memberForm.doctorId) return;
              addMemberMutation.mutate({
                assignmentId: Number(memberForm.assignmentId),
                doctorId: Number(memberForm.doctorId),
                teamRole: memberForm.teamRole,
              });
            }}
          >
            <h3 className="font-semibold">Add team member</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <select value={memberForm.assignmentId} onChange={(e) => setMemberForm((c) => ({ ...c, assignmentId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">Assignment</option>
                {(roster.assignments ?? []).map((assignment) => (
                  <option key={assignment.id} value={assignment.id}>{assignment.teamName} · {assignment.date}</option>
                ))}
              </select>
              <select value={memberForm.doctorId} onChange={(e) => setMemberForm((c) => ({ ...c, doctorId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">Doctor</option>
                {(doctorsQuery.data ?? []).map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.displayName}{conflictedDoctorIds.has(doctor.id) ? " · conflict" : ""}</option>
                ))}
              </select>
              <select value={memberForm.teamRole} onChange={(e) => setMemberForm((c) => ({ ...c, teamRole: e.target.value as RosterTeamRole }))} className="rounded-lg border px-3 py-2 text-sm">
                {TEAM_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </div>
            <button type="submit" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Add member</button>
          </form>
        </section>
      )}

      {showAdvancedRosterTools && (
        <section className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <div className="space-y-3">
            <h3 className="font-semibold">Roster templates</h3>
            {(templatesQuery.data ?? []).length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No roster templates yet.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {(templatesQuery.data ?? []).map((template) => (
                  <p key={template.id}>{template.name} · {template.templateType.replaceAll("_", " ")} · {template.assignments.length} duties</p>
                ))}
              </div>
            )}
            <form
              className="grid gap-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!templateApplyForm.templateId) return;
                applyTemplateMutation.mutate({
                  templateId: Number(templateApplyForm.templateId),
                  targetWeekStartDate: weekStart,
                  copyMode: templateApplyForm.copyMode,
                  overwriteExisting: templateApplyForm.overwriteExisting,
                  modalityId: null,
                });
              }}
            >
              <select value={templateApplyForm.templateId} onChange={(e) => setTemplateApplyForm((c) => ({ ...c, templateId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">Select template</option>
                {(templatesQuery.data ?? []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              <select value={templateApplyForm.copyMode} onChange={(e) => setTemplateApplyForm((c) => ({ ...c, copyMode: e.target.value as RosterTemplateCopyMode }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="structure_only">Structure only</option>
                <option value="structure_with_named_doctors">Structure with named doctors</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={templateApplyForm.overwriteExisting} onChange={(e) => setTemplateApplyForm((c) => ({ ...c, overwriteExisting: e.target.checked }))} />
                Overwrite existing draft duties
              </label>
              <button type="submit" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Apply template</button>
            </form>
            {templateApplyResult && (
              <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
                Template applied: {templateApplyResult.createdAssignmentCount} duties, {templateApplyResult.copiedMemberCount} doctors, {templateApplyResult.skippedCount} skipped.
                {templateApplyResult.conflicts.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {templateApplyResult.conflicts.map((conflict, index) => (
                      <p key={`${conflict.code}-${index}`} style={{ color: conflict.severity === "error" ? "#dc2626" : "var(--text-muted)" }}>{conflict.severity.toUpperCase()}: {conflict.message}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            <form
              className="mt-4 grid gap-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                generateMutation.mutate({
                  weekStartDate: weekStart,
                  templateId: generateForm.templateId ? Number(generateForm.templateId) : null,
                  modalityId: null,
                  includeDoctors: generateForm.includeDoctors,
                  balanceStrategy: generateForm.balanceStrategy,
                });
              }}
            >
              <h3 className="sm:col-span-2 font-semibold">Generate draft roster</h3>
              <select value={generateForm.templateId} onChange={(e) => setGenerateForm((c) => ({ ...c, templateId: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="">No template</option>
                {(templatesQuery.data ?? []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              <select value={generateForm.balanceStrategy} onChange={(e) => setGenerateForm((c) => ({ ...c, balanceStrategy: e.target.value as RosterBalanceStrategy }))} className="rounded-lg border px-3 py-2 text-sm">
                <option value="simple">Simple</option>
                <option value="preserve_previous">Preserve previous</option>
                <option value="least_assigned">Least assigned</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={generateForm.includeDoctors} onChange={(e) => setGenerateForm((c) => ({ ...c, includeDoctors: e.target.checked }))} />
                Auto-fill doctors
              </label>
              <button type="submit" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Generate draft roster</button>
            </form>
            {generateResult && (
              <div className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}>
                Generated: {generateResult.assignmentsCreated} duties, {generateResult.membersAssigned} doctors assigned.
                {generateResult.unfilledRequirements.length > 0 && (
                  <p className="mt-1" style={{ color: "#dc2626" }}>Unfilled: {generateResult.unfilledRequirements.join("; ")}</p>
                )}
              </div>
            )}
          </div>

          {canManageTemplates && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!templateForm.dutyType) return;
                createTemplateMutation.mutate({
                  name: templateForm.name || "New roster template",
                  description: null,
                  modalityId: null,
                  templateType: templateForm.templateType,
                  assignments: [{
                    dayOfWeek: Number(templateForm.dayOfWeek),
                    modalityId: null,
                    dutyType: templateForm.dutyType,
                    sessionName: null,
                    startTime: "08:00",
                    endTime: "14:00",
                    teamName: templateForm.teamName || "Template team",
                    sortOrder: 0,
                    members: [{
                      doctorId: null,
                      teamRole: "lead",
                      placeholderLabel: templateForm.placeholderLabel || "Lead specialist",
                      requiredRole: templateForm.requiredRole || "specialist",
                    }],
                  }],
                });
              }}
            >
              <h3 className="font-semibold">Create template</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <input placeholder="Template name" value={templateForm.name} onChange={(e) => setTemplateForm((c) => ({ ...c, name: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
                <select value={templateForm.templateType} onChange={(e) => setTemplateForm((c) => ({ ...c, templateType: e.target.value as RosterTemplateType }))} className="rounded-lg border px-3 py-2 text-sm">
                  {TEMPLATE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
                <select value={templateForm.dayOfWeek} onChange={(e) => setTemplateForm((c) => ({ ...c, dayOfWeek: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm">
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => <option key={day} value={day}>Day {day}</option>)}
                </select>
                <select value={templateForm.dutyType} onChange={(e) => setTemplateForm((c) => ({ ...c, dutyType: e.target.value as RosterDutyType }))} className="rounded-lg border px-3 py-2 text-sm">
                  <option value="">Duty type</option>
                  {activeDutyTypes.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}
                </select>
                <input placeholder="Team name" value={templateForm.teamName} onChange={(e) => setTemplateForm((c) => ({ ...c, teamName: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
                <input placeholder="Placeholder" value={templateForm.placeholderLabel} onChange={(e) => setTemplateForm((c) => ({ ...c, placeholderLabel: e.target.value }))} className="rounded-lg border px-3 py-2 text-sm" />
              </div>
              <button type="submit" disabled={!templateForm.dutyType || activeDutyTypes.length === 0} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>Create template</button>
            </form>
          )}
        </section>
      )}

      {rosterQuery.isLoading ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)" }}>Loading roster...</div>
      ) : (
        <AssignmentList
          assignments={roster?.assignments ?? []}
          canManage={Boolean(editable)}
          onDeleteAssignment={(assignmentId) => deleteAssignmentMutation.mutate(assignmentId)}
          onRemoveMember={(assignmentId, memberId) => removeMemberMutation.mutate({ assignmentId, memberId })}
          conflicts={conflicts}
          dutyTypeLabels={dutyTypeLabels}
        />
      )}
    </div>
  );
}
