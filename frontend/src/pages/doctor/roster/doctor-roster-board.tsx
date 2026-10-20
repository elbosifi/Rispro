import "./roster-board.css";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Button,
  Input,
  Card,
  Badge,
  LoadingState,
  EmptyState,
  ErrorState,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/shared";
import {
  addDoctorRosterMember,
  createDoctorRosterAssignment,
  deleteDoctorRosterAssignment,
  deleteDoctorRosterMember,
  fetchAppointmentLookups,
  fetchDoctorRosterWeek,
  fetchRosterDoctors,
  fetchRosterDutyTypes,
  fetchRosterWeekConflicts,
  fetchSavedDoctorRosters,
  publishDoctorRosterWeek,
  transferDoctorRosterMember,
  updateDoctorRosterSection,
} from "@/lib/api-hooks";
import type {
  DoctorMe,
  DoctorProfile,
  DoctorRosterAssignment,
} from "@/types/api";
import { LanguageContext, useLanguage } from "@/providers/language-provider";
import { t as translate, type Language } from "@/lib/i18n";
import {
  DoctorGroups,
  DoctorPickerRows,
  type DoctorDragData,
} from "./roster-doctors";
import { RosterSection } from "./roster-section";
import { RosterCreateDialog } from "./roster-create-dialog";
import {
  configuredRosterDutyLabel,
  nextRosterRange,
  rosterDays,
  tripoliDate,
} from "./roster-board-utils";

// The surrounding Doctor shell remains English. Only this workflow uses the saved language.
export function DoctorRosterBoard({ me }: { me: DoctorMe }) {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("rispro-language") === "ar" ? "ar" : "en",
  );
  const changeLanguage = (value: Language) => {
    setLanguage(value);
    localStorage.setItem("rispro-language", value);
  };
  return (
    <LanguageContext.Provider
      value={{
        language,
        isArabic: language === "ar",
        setLanguage: changeLanguage,
        toggleLanguage: () => changeLanguage(language === "ar" ? "en" : "ar"),
        t: (key, params) => translate(language, key, params),
      }}
    >
      <RosterBoard me={me} />
    </LanguageContext.Provider>
  );
}

function RosterBoard({ me }: { me: DoctorMe }) {
  const { t, language, setLanguage } = useLanguage();
  const queryClient = useQueryClient();
  const authorized =
    me.moduleCapabilities.includes("doctor_supervisor") ||
    me.moduleCapabilities.includes("doctor_admin");
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [doctorsOpen, setDoctorsOpen] = useState(false);
  const [publishError, setPublishError] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorProfile | null>(
    null,
  );
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [picker, setPicker] = useState<DoctorRosterAssignment | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [settings, setSettings] = useState<DoctorRosterAssignment | null>(null);
  const [removeSection, setRemoveSection] =
    useState<DoctorRosterAssignment | null>(null);
  const [transfer, setTransfer] = useState<{
    doctor: DoctorDragData;
    targetId: string;
  } | null>(null);
  const [dragging, setDragging] = useState<DoctorDragData | null>(null);
  const [custom, setCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDuty, setCustomDuty] = useState("");
  const [feedback, setFeedback] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const saved = useQuery({
    queryKey: ["doctor", "roster", "saved"],
    queryFn: fetchSavedDoctorRosters,
    enabled: authorized,
  });
  const weeks = saved.data ?? [];
  const today = tripoliDate();
  const initialWeek =
    weeks.find(
      (week) => week.weekStartDate <= today && week.weekEndDate >= today,
    ) ??
    [...weeks].reverse().find((week) => week.weekStartDate > today) ??
    weeks[0];
  const start =
    selectedStart ?? initialWeek?.weekStartDate ?? nextRosterRange().start;
  const roster = useQuery({
    queryKey: ["doctor", "roster", "week", start],
    queryFn: () => fetchDoctorRosterWeek(start),
    enabled: authorized && saved.isSuccess,
  });
  const doctors = useQuery({
    queryKey: ["doctor", "roster", "doctors"],
    queryFn: fetchRosterDoctors,
    enabled: authorized,
  });
  const duties = useQuery({
    queryKey: ["doctor", "roster", "duty-types"],
    queryFn: () => fetchRosterDutyTypes(false),
    enabled: authorized,
  });
  const lookups = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    enabled: authorized,
    staleTime: 300_000,
  });
  const week = roster.data?.week;
  const sections = (roster.data?.assignments ?? []).filter(
    (section) => section.status === "active",
  );
  const editable = Boolean(
    authorized && week?.status === "draft" && week.weekEndDate >= today,
  );
  const conflicts = useQuery({
    queryKey: ["doctor", "roster", "conflicts", week?.id],
    queryFn: () => fetchRosterWeekConflicts(Number(week!.id)),
    enabled: authorized && Boolean(week),
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "roster"] });
  };
  const mutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onMutate: () => setPublishError(false),
    onSuccess: async () => {
      await invalidate();
      setFeedback(t("roster.saved"));
    },
    onError: () => setFeedback(""),
  });
  const busy = mutation.isPending;
  const days = week ? rosterDays(week.weekStartDate, week.weekEndDate) : [];
  const day = activeDay && days.includes(activeDay) ? activeDay : days[0];
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", {
      weekday: "long",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  const allConflicts = conflicts.data ?? [];
  const errors = allConflicts.filter(
    (conflict) => conflict.severity === "error",
  );
  const indicators = new Map<number, string>();
  for (const conflict of allConflicts) {
    if (
      conflict.doctorId &&
      sections.some(
        (section) =>
          section.date === day &&
          Number(section.id) === Number(conflict.assignmentId),
      )
    )
      indicators.set(Number(conflict.doctorId), t("roster.dayConflict"));
  }
  const activeDuties = (duties.data ?? []).filter((duty) => duty.active);
  const defaultDuty =
    activeDuties.find((duty) => duty.code === "general_reporting")?.code ??
    activeDuties.find((duty) => /reporting/.test(duty.code))?.code ??
    "";
  const customDefaultDuty = defaultDuty || activeDuties[0]?.code || "";
  const sectionTypes = [
    { kind: "ct", pattern: /^ct_/, modality: /^(ct)$/i },
    { kind: "mri", pattern: /^mri_/, modality: /^(mr|mri)$/i },
    {
      kind: "ultrasound",
      pattern: /^ultrasound_/,
      modality: /^(us|ultrasound)$/i,
    },
    {
      kind: "mammography",
      pattern: /^mammography_/,
      modality: /^(mg|mammo|mammography)$/i,
    },
    { kind: "reporting", pattern: /^general_reporting$/, modality: /$^/ },
    { kind: "ir", pattern: /^(ir_|interventional)/, modality: /^(ir|xa)$/i },
  ] as const;
  const assign = (section: DoctorRosterAssignment, doctorId: number) => {
    if (!editable || busy) return;
    if (
      section.members.some((member) => Number(member.doctorId) === doctorId)
    ) {
      setFeedback(t("roster.alreadyAssigned"));
      return;
    }
    mutation.mutate(
      () => addDoctorRosterMember(Number(section.id), { doctorId }),
      {
        onSuccess: () => {
          setPicker(null);
          setSelectedDoctor(null);
          setFeedback(
            t("roster.assignedTo", {
              name:
                (doctors.data ?? []).find((row) => Number(row.id) === doctorId)
                  ?.displayName ?? "",
              section: section.teamName,
              day: dayLabel(section.date),
            }),
          );
        },
      },
    );
  };
  const addSection = (kind: (typeof sectionTypes)[number] | "custom") => {
    if (!week || !addingDay || !editable || busy) return;
    const dutyType =
      kind === "custom"
        ? customDuty || customDefaultDuty
        : (activeDuties.find((duty) => kind.pattern.test(duty.code))?.code ??
          defaultDuty);
    const modality =
      kind === "custom"
        ? null
        : lookups.data?.modalities.find(
            (modality) =>
              modality.isActive !== false &&
              kind.modality.test(modality.code ?? ""),
          );
    mutation.mutate(
      () =>
        createDoctorRosterAssignment({
          rosterWeekId: Number(week.id),
          date: addingDay,
          dutyType,
          modalityId: modality ? Number(modality.id) : null,
          teamName:
            kind === "custom"
              ? customName.trim()
              : t(`roster.type.${kind.kind}`),
          sessionName: null,
          startTime: "08:00",
          endTime: "14:00",
        }),
      {
        onSuccess: () => {
          setAddingDay(null);
          setCustom(false);
          setCustomName("");
        },
      },
    );
  };
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const data = event.active.data.current as DoctorDragData | undefined;
    const target = sections.find(
      (section) =>
        Number(section.id) === Number(event.over?.data.current?.assignmentId),
    );
    if (
      !data ||
      !target ||
      !editable ||
      busy ||
      data.assignmentId === Number(target.id)
    )
      return;
    if (data.memberId)
      setTransfer({ doctor: data, targetId: String(target.id) });
    else assign(target, data.doctorId);
  };
  const loading =
    saved.isLoading ||
    roster.isLoading ||
    doctors.isLoading ||
    duties.isLoading ||
    lookups.isLoading;
  const failed =
    saved.isError ||
    roster.isError ||
    doctors.isError ||
    duties.isError ||
    lookups.isError;
  const retry = () => {
    void saved.refetch();
    void roster.refetch();
    void doctors.refetch();
    void duties.refetch();
    void lookups.refetch();
  };
  if (!authorized) return <ErrorState message={t("roster.unauthorized")} />;
  return (
    <div
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
      className="roster-board min-w-0 space-y-4"
      data-testid="doctor-roster-board"
    >
      <header
        className="roster-toolbar sticky top-14 z-20 flex flex-wrap items-start justify-between gap-3 border-b pb-3 lg:top-0"
        style={{
          background: "var(--background)",
          borderColor: "var(--border)",
        }}
      >
        <div>
          <p className="text-sm text-muted-foreground">{t("roster.planner")}</p>
          <h2 className="mt-1 text-xl font-semibold">
            <bdi>
              {week
                ? `${week.weekStartDate} – ${week.weekEndDate}`
                : t("roster.planWeek")}
            </bdi>
          </h2>
          <div className="mt-2 flex items-center gap-2">
            {week && (
              <Badge variant={week.status === "published" ? "success" : "info"}>
                {t(`roster.status.${week.status}`)}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {t(
                busy
                  ? "roster.saving"
                  : editable
                    ? "roster.autoSave"
                    : week
                      ? "roster.readOnly"
                      : "roster.createHelp",
              )}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setFeedback("");
              setLanguage(language === "ar" ? "en" : "ar");
            }}
          >
            {language === "ar" ? "English" : "العربية"}
          </Button>
          <Button
            size="sm"
            disabled={!saved.isSuccess || busy}
            onClick={() => setCreateOpen(true)}
          >
            {t("roster.create")}
          </Button>
          {editable && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !conflicts.isSuccess}
              onClick={() =>
                mutation.mutate(
                  () => publishDoctorRosterWeek(Number(week!.id)),
                  {
                    onError: () => {
                      setPublishError(true);
                      void conflicts.refetch();
                    },
                    onSuccess: () => setFeedback(t("roster.published")),
                  },
                )
              }
            >
              {t("roster.publish")}
            </Button>
          )}
        </div>
      </header>
      {weeks.length > 0 && (
        <nav
          aria-label={t("roster.navigate")}
          className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap"
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !weeks.some((row) => row.weekStartDate < start)}
            onClick={() => {
              setSelectedStart(
                weeks.find((row) => row.weekStartDate < start)!.weekStartDate,
              );
              setSelectedDoctor(null);
            }}
          >
            {t("roster.previous")}
          </Button>
          <label className="order-first col-span-2 min-w-0 text-sm sm:order-none sm:flex-1 sm:max-w-sm">
            <span className="sr-only">{t("roster.savedRosters")}</span>
            <select
              aria-label={t("roster.savedRosters")}
              className="input-premium w-full"
              value={start}
              disabled={busy}
              onChange={(event) => {
                setSelectedStart(event.target.value);
                setSelectedDoctor(null);
              }}
            >
              {weeks.map((row) => (
                <option value={row.weekStartDate} key={row.id}>
                  {row.weekStartDate} – {row.weekEndDate} ·{" "}
                  {t(`roster.status.${row.status}`)}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !weeks.some((row) => row.weekStartDate > start)}
            onClick={() => {
              setSelectedStart(
                [...weeks].reverse().find((row) => row.weekStartDate > start)!
                  .weekStartDate,
              );
              setSelectedDoctor(null);
            }}
          >
            {t("roster.next")}
          </Button>
        </nav>
      )}
      {feedback && (
        <p
          role="status"
          className="rounded-lg border p-3 text-sm"
          style={{ borderColor: "var(--accent)" }}
        >
          {feedback}
        </p>
      )}
      {mutation.isError && (
        <p
          role="alert"
          className="rounded-lg border p-3 text-sm"
          style={{ borderColor: "var(--red)" }}
        >
          {t(publishError ? "roster.publishError" : "roster.changeError")}
        </p>
      )}
      {loading ? (
        <LoadingState message={t("roster.loading")} />
      ) : failed ? (
        <Card>
          <ErrorState message={t("roster.loadError")} />
          <Button variant="secondary" onClick={retry}>
            {t("roster.retry")}
          </Button>
        </Card>
      ) : !week ? (
        <EmptyState message={t("roster.createHelp")} />
      ) : (
        <>
          {conflicts.isError ? (
            <p role="alert">
              {t("roster.conflictsError")}{" "}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => conflicts.refetch()}
              >
                {t("roster.retry")}
              </Button>
            </p>
          ) : (
            allConflicts.length > 0 && (
              <p
                role="status"
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Badge variant={errors.length ? "warning" : "info"}>
                  {t("roster.conflictCount", { count: errors.length })}
                </Badge>
                {t("roster.conflictsHelp")}
              </p>
            )
          )}
          <DndContext
            collisionDetection={(args) => {
              const hits = pointerWithin(args);
              return hits.length ? hits : rectIntersection(args);
            }}
            sensors={sensors}
            onDragStart={(event) =>
              setDragging(event.active.data.current as DoctorDragData)
            }
            onDragCancel={() => setDragging(null)}
            onDragEnd={onDragEnd}
            accessibility={{
              announcements: {
                onDragStart: () => t("roster.dragStarted"),
                onDragOver: ({ over }) =>
                  over ? t("roster.overSection") : t("roster.dragStarted"),
                onDragEnd: ({ over }) =>
                  over ? t("roster.dropFinished") : t("roster.dragCancelled"),
                onDragCancel: () => t("roster.dragCancelled"),
              },
              screenReaderInstructions: { draggable: t("roster.keyboardDrag") },
            }}
          >
            <div className="grid min-w-0 gap-4 xl:grid-cols-[185px_minmax(0,1fr)]">
              {editable && (
                <aside
                  className="min-w-0 xl:sticky xl:top-0 xl:self-start"
                  aria-label={t("roster.doctors")}
                >
                  <div
                    className="rounded-xl border p-3"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--card)",
                    }}
                  >
                    <h3 className="roster-doctors-title font-semibold">
                      {t("roster.doctors")}
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="roster-doctors-toggle w-full"
                      aria-expanded={doctorsOpen}
                      aria-controls="roster-doctors-panel"
                      onClick={() => setDoctorsOpen((value) => !value)}
                    >
                      {t("roster.doctors")} {doctorsOpen ? "−" : "+"}
                    </Button>
                    <div
                      id="roster-doctors-panel"
                      className={`${doctorsOpen ? "block" : "hidden"} mt-3 max-h-72 space-y-3 overflow-y-auto xl:block xl:max-h-[65vh]`}
                    >
                      <p className="text-xs text-muted-foreground">
                        {t("roster.assignHelp")}
                      </p>
                      <DoctorGroups
                        doctors={doctors.data ?? []}
                        search={search}
                        onSearch={setSearch}
                        selectedId={
                          selectedDoctor ? Number(selectedDoctor.id) : undefined
                        }
                        onSelect={(doctor) => {
                          setSelectedDoctor((current) =>
                            Number(current?.id) === Number(doctor.id)
                              ? null
                              : doctor,
                          );
                          setDoctorsOpen(false);
                        }}
                        disabled={busy}
                        indicators={indicators}
                      />
                    </div>
                  </div>
                </aside>
              )}
              <section
                className={`min-w-0 ${!editable ? "xl:col-span-2" : ""}`}
                aria-label={t("roster.schedule")}
              >
                <div className="mb-3 xl:hidden">
                  <label className="text-sm font-semibold">
                    {t("roster.selectedDay")}
                    <select
                      aria-label={t("roster.selectedDay")}
                      className="input-premium mt-1 w-full"
                      value={day}
                      onChange={(event) => setActiveDay(event.target.value)}
                    >
                      {days.map((date) => (
                        <option key={date} value={date}>
                          {dayLabel(date)} · {date}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid min-w-0 gap-3 xl:grid-cols-5">
                  {days.map((date) => (
                    <section
                      key={date}
                      aria-label={`${dayLabel(date)} ${date}`}
                      className={`${day === date ? "block" : "hidden"} min-w-0 space-y-3 rounded-xl border p-2 xl:block`}
                      style={{
                        borderColor: "var(--border)",
                        background:
                          "color-mix(in srgb, var(--card) 55%, transparent)",
                      }}
                      onFocus={() => setActiveDay(date)}
                    >
                      <header
                        className="border-b pb-3"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <h3 className="font-semibold">{dayLabel(date)}</h3>
                        <p className="text-xs text-muted-foreground">
                          <bdi>{date}</bdi>
                        </p>
                      </header>
                      {sections
                        .filter((section) => section.date === date)
                        .map((section) => (
                          <RosterSection
                            key={section.id}
                            section={section}
                            conflicts={allConflicts.filter(
                              (conflict) =>
                                Number(conflict.assignmentId) ===
                                Number(section.id),
                            )}
                            editable={editable}
                            busy={busy}
                            dragging={Boolean(dragging)}
                            selected={selectedDoctor?.displayName}
                            onAdd={() =>
                              selectedDoctor
                                ? assign(section, Number(selectedDoctor.id))
                                : (setPicker(section), setPickerSearch(""))
                            }
                            onSettings={() => setSettings({ ...section })}
                            onRemove={() =>
                              section.members.length
                                ? setRemoveSection(section)
                                : mutation.mutate(() =>
                                    deleteDoctorRosterAssignment(
                                      Number(section.id),
                                    ),
                                  )
                            }
                            onRemoveMember={(member) =>
                              mutation.mutate(() =>
                                deleteDoctorRosterMember(
                                  Number(section.id),
                                  Number(member.id),
                                ),
                              )
                            }
                            onRole={(member, teamRole) =>
                              mutation.mutate(() =>
                                addDoctorRosterMember(Number(section.id), {
                                  doctorId: Number(member.doctorId),
                                  teamRole,
                                }),
                              )
                            }
                            onTransfer={(doctor) =>
                              setTransfer({ doctor, targetId: "" })
                            }
                          />
                        ))}
                      {editable && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full border border-dashed"
                          disabled={busy}
                          onClick={() => {
                            setAddingDay((current) =>
                              current === date ? null : date,
                            );
                            setCustom(false);
                            setActiveDay(date);
                          }}
                        >
                          {t("roster.addSection")}
                        </Button>
                      )}
                      {editable && addingDay === date && (
                        <div
                          className="space-y-2 rounded-lg border p-2"
                          style={{
                            borderColor: "var(--accent)",
                            background: "var(--card)",
                          }}
                        >
                          {sectionTypes.map((type) => (
                            <Button
                              key={type.kind}
                              size="sm"
                              variant="secondary"
                              className="h-auto min-h-9 w-full whitespace-normal px-1"
                              disabled={
                                busy ||
                                (!defaultDuty &&
                                  !activeDuties.some((duty) =>
                                    type.pattern.test(duty.code),
                                  ))
                              }
                              onClick={() => addSection(type)}
                            >
                              {t(`roster.type.${type.kind}`)}
                            </Button>
                          ))}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCustom(true)}
                          >
                            {t("roster.type.custom")}
                          </Button>
                          {custom && (
                            <form
                              className="space-y-2"
                              onSubmit={(event) => {
                                event.preventDefault();
                                addSection("custom");
                              }}
                            >
                              <label className="text-xs">
                                {t("roster.sectionName")}
                                <Input
                                  required
                                  value={customName}
                                  onChange={(event) =>
                                    setCustomName(event.target.value)
                                  }
                                />
                              </label>
                              <label className="text-xs">
                                {t("roster.duty")}
                                <select
                                  className="input-premium w-full"
                                  value={customDuty || customDefaultDuty}
                                  onChange={(event) =>
                                    setCustomDuty(event.target.value)
                                  }
                                >
                                  {activeDuties.map((duty) => (
                                    <option key={duty.code} value={duty.code}>
                                      {configuredRosterDutyLabel(duty, t)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <Button
                                type="submit"
                                size="sm"
                                disabled={
                                  busy ||
                                  !customName.trim() ||
                                  !customDefaultDuty
                                }
                              >
                                {t("roster.add")}
                              </Button>
                            </form>
                          )}
                          {activeDuties.length === 0 && (
                            <p role="alert" className="text-xs">
                              {t("roster.noDuty")}
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAddingDay(null)}
                          >
                            {t("roster.cancel")}
                          </Button>
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              </section>
            </div>
            <DragOverlay>
              {dragging && (
                <div
                  className="max-w-60 rounded-lg border p-3 text-sm shadow-lg"
                  style={{
                    background: "var(--card)",
                    borderColor: "var(--accent)",
                  }}
                >
                  {dragging.label}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </>
      )}
      {createOpen && (
        <RosterCreateDialog
          weeks={weeks}
          onClose={() => setCreateOpen(false)}
          onCreated={async (newStart) => {
            setSelectedStart(newStart);
            setActiveDay(null);
            setFeedback(t("roster.created"));
            await invalidate();
          }}
        />
      )}
      {picker && (
        <Dialog
          open
          onClose={() => {
            if (!busy) setPicker(null);
          }}
        >
          <DialogContent maxWidth="460px" aria-labelledby="roster-picker-title">
            <DialogHeader closeLabel={t("roster.close")}>
              <DialogTitle id="roster-picker-title">
                {t("roster.addTo", { name: picker.teamName })}
              </DialogTitle>
            </DialogHeader>
            <label className="block text-sm">
              {t("roster.searchDoctors")}
              <Input
                type="search"
                value={pickerSearch}
                onChange={(event) => setPickerSearch(event.target.value)}
              />
            </label>
            {mutation.isError && <p role="alert">{t("roster.changeError")}</p>}
            <fieldset disabled={busy}>
              <DoctorPickerRows
                doctors={(doctors.data ?? []).filter((doctor) =>
                  doctor.displayName
                    .toLocaleLowerCase()
                    .includes(pickerSearch.toLocaleLowerCase()),
                )}
                members={
                  sections.find(
                    (section) => Number(section.id) === Number(picker.id),
                  )?.members ?? []
                }
                onPick={(doctor) => assign(picker, Number(doctor.id))}
              />
            </fieldset>
          </DialogContent>
        </Dialog>
      )}
      {settings && (
        <Dialog
          open
          onClose={() => {
            if (!busy) setSettings(null);
          }}
        >
          <DialogContent
            maxWidth="480px"
            aria-labelledby="roster-settings-title"
          >
            <DialogHeader closeLabel={t("roster.close")}>
              <DialogTitle id="roster-settings-title">
                {t("roster.settings")}
              </DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                mutation.mutate(
                  () =>
                    updateDoctorRosterSection(Number(settings.id), {
                      date: settings.date,
                      modalityId: settings.modalityId,
                      dutyType: settings.dutyType,
                      sessionName: settings.sessionName,
                      startTime: settings.startTime,
                      endTime: settings.endTime,
                      teamName: settings.teamName,
                    }),
                  { onSuccess: () => setSettings(null) },
                );
              }}
            >
              <label className="block text-sm">
                {t("roster.sectionName")}
                <Input
                  required
                  value={settings.teamName}
                  onChange={(event) =>
                    setSettings({ ...settings, teamName: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm">
                {t("roster.duty")}
                <select
                  className="input-premium w-full"
                  value={settings.dutyType}
                  onChange={(event) =>
                    setSettings({ ...settings, dutyType: event.target.value })
                  }
                >
                  {activeDuties.map((duty) => (
                    <option key={duty.code} value={duty.code}>
                      {configuredRosterDutyLabel(duty, t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t("roster.modality")}
                <select
                  className="input-premium w-full"
                  value={settings.modalityId ?? ""}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      modalityId: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                >
                  <option value="">{t("roster.noModality")}</option>
                  {lookups.data?.modalities.map((modality) => (
                    <option key={modality.id} value={modality.id}>
                      {language === "ar"
                        ? modality.nameAr || modality.nameEn
                        : modality.nameEn}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t("roster.session")}
                <Input
                  value={settings.sessionName ?? ""}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      sessionName: event.target.value || null,
                    })
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  {t("roster.startTime")}
                  <Input
                    type="time"
                    value={settings.startTime?.slice(0, 5) ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        startTime: event.target.value || null,
                      })
                    }
                  />
                </label>
                <label className="text-sm">
                  {t("roster.endTime")}
                  <Input
                    type="time"
                    value={settings.endTime?.slice(0, 5) ?? ""}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        endTime: event.target.value || null,
                      })
                    }
                  />
                </label>
              </div>
              {mutation.isError && (
                <p role="alert">{t("roster.changeError")}</p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setSettings(null)}
                >
                  {t("roster.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={busy || !settings.teamName.trim()}
                >
                  {t("roster.save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {removeSection && (
        <Dialog
          open
          onClose={() => {
            if (!busy) setRemoveSection(null);
          }}
        >
          <DialogContent aria-labelledby="roster-remove-title">
            <DialogHeader closeLabel={t("roster.close")}>
              <DialogTitle id="roster-remove-title">
                {t("roster.removeSection")}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              {t("roster.removeConfirm", {
                name: removeSection.teamName,
                count: removeSection.members.length,
              })}
            </p>
            {mutation.isError && <p role="alert">{t("roster.changeError")}</p>}
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setRemoveSection(null)}
              >
                {t("roster.cancel")}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  mutation.mutate(
                    () =>
                      deleteDoctorRosterAssignment(Number(removeSection.id)),
                    { onSuccess: () => setRemoveSection(null) },
                  )
                }
              >
                {t("roster.removeSection")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {transfer && (
        <Dialog
          open
          onClose={() => {
            if (!busy) setTransfer(null);
          }}
        >
          <DialogContent
            maxWidth="460px"
            aria-labelledby="roster-transfer-title"
          >
            <DialogHeader closeLabel={t("roster.close")}>
              <DialogTitle id="roster-transfer-title">
                {t("roster.moveCopy")}
              </DialogTitle>
            </DialogHeader>
            <p className="mb-3 break-words text-sm">{transfer.doctor.label}</p>
            <label className="block text-sm">
              {t("roster.targetSection")}
              <select
                aria-label={t("roster.targetSection")}
                className="input-premium w-full"
                value={transfer.targetId}
                onChange={(event) =>
                  setTransfer({ ...transfer, targetId: event.target.value })
                }
              >
                <option value="">{t("roster.chooseSection")}</option>
                {sections
                  .filter(
                    (section) =>
                      Number(section.id) !== transfer.doctor.assignmentId &&
                      !section.members.some(
                        (member) =>
                          Number(member.doctorId) === transfer.doctor.doctorId,
                      ),
                  )
                  .map((section) => (
                    <option value={section.id} key={section.id}>
                      {dayLabel(section.date)} · {section.teamName} ·{" "}
                      {section.startTime?.slice(0, 5)} · #{section.id}
                    </option>
                  ))}
              </select>
            </label>
            <p className="mt-3 text-sm text-muted-foreground">
              {t("roster.moveCopyHelp")}
            </p>
            {mutation.isError && <p role="alert">{t("roster.changeError")}</p>}
            <DialogFooter>
              {(["move", "copy"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={mode === "move" ? "primary" : "secondary"}
                  disabled={!transfer.targetId || busy}
                  onClick={() =>
                    mutation.mutate(
                      () =>
                        transferDoctorRosterMember(
                          transfer.doctor.assignmentId!,
                          transfer.doctor.memberId!,
                          Number(transfer.targetId),
                          mode,
                        ),
                      { onSuccess: () => setTransfer(null) },
                    )
                  }
                >
                  {t(`roster.${mode}`)}
                </Button>
              ))}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
