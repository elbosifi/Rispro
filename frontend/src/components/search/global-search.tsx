import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2, Search, UserRound, X } from "lucide-react";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { Patient } from "@/types/api";
import { fetchAppointments, searchPatients } from "@/lib/api-hooks";
import { formatDateLy } from "@/lib/date-format";
import { chooseLocalized, statusLabel, t, type Language } from "@/lib/i18n";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";

type Result = { kind: "patient"; value: Patient } | { kind: "registration"; value: AppointmentWithDetails };

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

function useDebouncedValue(value: string, delay = 275) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

export function GlobalSearch({ language, isRtl, canSearchPatients, canSearchRegistrations, onPatientSelect, onRegistrationSelect }: {
  language: Language;
  isRtl: boolean;
  canSearchPatients: boolean;
  canSearchRegistrations: boolean;
  onPatientSelect: (patientId: number) => void;
  onRegistrationSelect: (appointment: AppointmentWithDetails) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const term = useDebouncedValue(query.trim());
  const canSearch = open && term.length >= 2;
  const patientQuery = useQuery({ queryKey: ["global-search", "patients", term], queryFn: () => searchPatients(term), enabled: canSearch && canSearchPatients, staleTime: 30_000, retry: false });
  const registrationQuery = useQuery({ queryKey: ["global-search", "registrations", term], queryFn: () => fetchAppointments({ q: term }), enabled: canSearch && canSearchRegistrations, staleTime: 30_000, retry: false });
  const patients = (Array.isArray(patientQuery.data) ? patientQuery.data : []).slice(0, 5);
  const registrations = (Array.isArray(registrationQuery.data) ? registrationQuery.data : []).filter((item) => !["cancelled", "discontinued", "voided"].includes(item.status)).slice(0, 5);
  const results = useMemo<Result[]>(() => [...patients.map((value) => ({ kind: "patient" as const, value })), ...registrations.map((value) => ({ kind: "registration" as const, value }))], [patients, registrations]);
  const loading = patientQuery.isLoading || registrationQuery.isLoading;
  const failed = patientQuery.isError || registrationQuery.isError;
  const showResults = canSearch && !loading && !failed;
  const placeholder = t(language, "globalSearch.placeholder");

  const close = () => { setOpen(false); setActiveIndex(0); };
  const select = (result: Result) => {
    close();
    if (result.kind === "patient") onPatientSelect(result.value.id);
    else onRegistrationSelect(result.value);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !isTypingTarget(event.target)) {
        event.preventDefault(); setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => { if (open && !rootRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  useEffect(() => setActiveIndex(0), [term, results.length]);

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (!results.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => (index + 1) % results.length); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index - 1 + results.length) % results.length); }
    if (event.key === "Enter") { event.preventDefault(); select(results[activeIndex]); }
  };
  const input = <div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input ref={inputRef} value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={onInputKeyDown} className="h-9 w-full rounded-xl border bg-card py-2 ps-9 pe-16 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20" style={{ borderColor: "var(--border)" }} placeholder={placeholder} aria-label={placeholder} role="combobox" aria-expanded={open} aria-controls={listboxId} aria-activedescendant={results[activeIndex] ? `global-search-result-${activeIndex}` : undefined} /><kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground xl:block">{navigator.platform?.includes("Mac") ? "⌘ K" : "Ctrl K"}</kbd></div>;
  const panel = open ? <div id={listboxId} role="listbox" className={`z-[60] max-h-[min(70vh,34rem)] overflow-y-auto rounded-xl border bg-card p-2 shadow-xl ${isRtl ? "text-right" : "text-left"}`} style={{ borderColor: "var(--border)" }}>
    {term.length < 2 ? <p className="px-3 py-4 text-sm text-muted-foreground">{t(language, "globalSearch.typeMore")}</p> : loading ? <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t(language, "globalSearch.loading")}</p> : failed ? <p className="px-3 py-4 text-sm text-red-600">{t(language, "globalSearch.error")}</p> : results.length === 0 ? <p className="px-3 py-4 text-sm text-muted-foreground">{t(language, "globalSearch.empty")}</p> : <>
      <p className="sr-only" aria-live="polite">{t(language, "globalSearch.resultCount", { count: results.length })}</p>
      {patients.length ? <ResultGroup title={t(language, "globalSearch.patients")}><>{patients.map((patient, index) => <button key={patient.id} id={`global-search-result-${index}`} role="option" aria-selected={activeIndex === index} onClick={() => select({ kind: "patient", value: patient })} className={`w-full rounded-lg px-3 py-2 text-start hover:bg-muted focus:bg-muted ${activeIndex === index ? "bg-muted" : ""}`}><span className="flex items-start gap-2"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span className="min-w-0 flex-1"><span className="block font-medium">{patient.arabicFullName}</span>{patient.englishFullName ? <span className="block truncate text-xs text-muted-foreground">{patient.englishFullName}</span> : null}<span className="block text-xs text-muted-foreground">{patient.mrn ? `MRN: ${patient.mrn}` : ""}{patient.phone1 ? `${patient.mrn ? " · " : ""}${patient.phone1}` : ""}{(patient.nationalId || patient.identifierValue) ? `${(patient.mrn || patient.phone1) ? " · " : ""}${patient.nationalId || patient.identifierValue}` : ""}</span></span><PatientCategoryBadge category={patient.category} /></span></button>)}</></ResultGroup> : null}
      {registrations.length ? <ResultGroup title={t(language, "globalSearch.registrations")}><>{registrations.map((appointment, index) => { const resultIndex = patients.length + index; return <button key={appointment.id} id={`global-search-result-${resultIndex}`} role="option" aria-selected={activeIndex === resultIndex} onClick={() => select({ kind: "registration", value: appointment })} className={`w-full rounded-lg px-3 py-2 text-start hover:bg-muted focus:bg-muted ${activeIndex === resultIndex ? "bg-muted" : ""}`}><span className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span className="min-w-0 flex-1"><span className="block font-medium">{appointment.accessionNumber} <span className="font-normal text-muted-foreground">· {chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName)}</span></span><span className="block truncate text-xs text-muted-foreground">{formatDateLy(appointment.appointmentDate)} · {chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn)}{appointment.examNameAr || appointment.examNameEn ? ` · ${chooseLocalized(language, appointment.examNameAr, appointment.examNameEn)}` : ""}</span></span><span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">{statusLabel(language, appointment.status)}</span></span></button>; })}</></ResultGroup> : null}
    </>}
  </div> : null;
  return <div ref={rootRef} className="contents"><div className="relative hidden min-w-[20rem] max-w-[26rem] flex-1 lg:block">{input}<div className="absolute start-0 top-full mt-2 w-full">{panel}</div></div><button type="button" className="btn-ghost lg:hidden" onClick={() => { setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0); }} aria-label={placeholder} title={placeholder}><Search className="h-4 w-4" /></button>{open ? <div className="fixed inset-x-3 top-14 z-[60] lg:hidden"><div className="rounded-xl border bg-card p-2 shadow-xl" style={{ borderColor: "var(--border)" }}><div className="mb-2 flex gap-2">{input}<button type="button" className="btn-ghost" aria-label={t(language, "common.dismiss")} onClick={close}><X className="h-4 w-4" /></button></div>{panel}</div></div> : null}</div>;
}

function ResultGroup({ title, children }: { title: string; children: ReactNode }) { return <section className="py-1"><h2 className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>{children}</section>; }
