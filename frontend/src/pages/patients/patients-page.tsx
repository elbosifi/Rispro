import { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchPatientDirectory, fetchPatientDirectorySummary, type PatientDirectoryParams } from "@/lib/api-hooks";
import PatientForm from "@/components/patients/patient-form";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { UserPlus, Search, Pencil, CalendarPlus, Printer, X, ChevronLeft, ChevronRight, AlertTriangle, Phone, Calendar, User, IdCard } from "lucide-react";
import { Button, Card, Badge } from "@/components/shared";
import type { PatientDirectoryRow, PatientDirectoryResponse, PatientDirectorySummary } from "@/types/api";

type CategoryFilter = "oncology" | "non_oncology" | "";
type AppointmentFilter = "has_future" | "today" | "no_future" | "";

function WarningBadge({ warning, label }: { warning: boolean; label: string }) {
  if (!warning) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      <AlertTriangle size={10} />
      {label}
    </span>
  );
}

function PatientDrawer({
  patientId,
  onClose
}: {
  patientId: number;
  onClose: () => void;
}) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isArabic = language === "ar";

  const { data: summary, isLoading } = useQuery({
    queryKey: ["patient-directory-summary", patientId],
    queryFn: () => fetchPatientDirectorySummary(patientId),
    staleTime: 1000 * 30
  });

  if (isLoading) {
    return (
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-background border-l border-border shadow-xl z-50 flex items-center justify-center">
        <div className="spinner-industrial h-8 w-8" />
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-background border-l border-border shadow-xl z-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h2 className="text-lg font-bold">{t(language, "patients.directory.drawer.title")}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X size={18} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            {t(language, "patients.directory.drawer.demographics")}
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t(language, "patients.nameAr")}</span>
              <span className="font-medium">{summary.demographics.arabicFullName}</span>
            </div>
            {summary.demographics.englishFullName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t(language, "patients.nameEn")}</span>
                <span>{summary.demographics.englishFullName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t(language, "patients.mrn")}</span>
              <span className="font-mono">{summary.demographics.mrn || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t(language, "patients.sex")}</span>
              <span>{summary.demographics.sex || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t(language, "patients.age")}</span>
              <span>{summary.demographics.ageYears}{summary.demographics.demographicsEstimated ? " (E)" : ""}</span>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            {t(language, "patients.directory.drawer.identifiers")}
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t(language, "patients.nationalId")}</span>
              <span className="font-mono">{summary.identifiers.nationalId || "—"}</span>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            {t(language, "patients.directory.drawer.contact")}
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t(language, "patients.phone")}</span>
              <span>{summary.contact.phone1 || "—"}</span>
            </div>
            {summary.contact.phone2 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t(language, "patients.phone")} 2</span>
                <span>{summary.contact.phone2}</span>
              </div>
            )}
          </div>
        </section>

        {summary.category && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
              {t(language, "patients.directory.drawer.category")}
            </h3>
            <PatientCategoryBadge category={summary.category} />
          </section>
        )}

        {(summary.warnings.missingPhone || summary.warnings.missingDob || summary.warnings.missingSex || summary.warnings.missingName || summary.warnings.incompleteData || summary.warnings.possibleDuplicate) && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
              {t(language, "patients.directory.drawer.warnings")}
            </h3>
            <div className="flex flex-wrap gap-2">
              <WarningBadge warning={summary.warnings.missingPhone} label={t(language, "patients.directory.warning.missingPhone")} />
              <WarningBadge warning={summary.warnings.missingDob} label={t(language, "patients.directory.warning.missingDob")} />
              <WarningBadge warning={summary.warnings.missingSex} label={t(language, "patients.directory.warning.missingSex")} />
              <WarningBadge warning={summary.warnings.missingName} label={t(language, "patients.directory.warning.missingName")} />
              <WarningBadge warning={summary.warnings.incompleteData} label={t(language, "patients.directory.warning.incomplete")} />
              <WarningBadge warning={summary.warnings.possibleDuplicate} label={t(language, "patients.directory.warning.possibleDuplicate")} />
            </div>
          </section>
        )}

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
            {t(language, "patients.directory.drawer.recentAppointments")}
          </h3>
          {summary.recentAppointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(language, "patients.directory.noAppointments")}</p>
          ) : (
            <div className="space-y-2">
              {summary.recentAppointments.slice(0, 5).map((appt) => (
                <div key={appt.id} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded">
                  <div>
                    <div className="font-medium">{appt.date}</div>
                    <div className="text-muted-foreground text-xs">{appt.modalityName}</div>
                  </div>
                  <Badge variant={appt.status === "completed" ? "success" : appt.status === "cancelled" ? "error" : "neutral"} size="sm">
                    {appt.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="p-4 border-t border-border">
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground mb-3">
          {t(language, "patients.directory.drawer.quickActions")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patientId}/edit`)}>
            <Pencil size={14} />
            {t(language, "patients.directory.action.edit")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/appointments?patientId=${patientId}`)}>
            <CalendarPlus size={14} />
            {t(language, "patients.directory.action.createAppointment")}
          </Button>
          {summary.lastAppointment && (
<Button size="sm" variant="outline" onClick={() => summary.lastAppointment && navigate(`/print?appointmentId=${summary.lastAppointment.id}`)}>
            <Printer size={14} />
            {t(language, "patients.directory.action.print")}
          </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PatientsPage() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const isNewRoute = location.pathname === "/patients/new" || location.pathname.startsWith("/patients/new");

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("");
  const [appointmentFilter, setAppointmentFilter] = useState<AppointmentFilter>("");
  const [sexFilter, setSexFilter] = useState<"male" | "female" | "">("");
  const [ageMin, setAgeMin] = useState<number | "">("");
  const [ageMax, setAgeMax] = useState<number | "">("");
  const [sortBy, setSortBy] = useState<"name" | "recent" | "mrn">("name");
  const [page, setPage] = useState(1);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);

  const params = useMemo((): PatientDirectoryParams => ({
    q: searchQuery || undefined,
    category: categoryFilter || undefined,
    appointmentFilter: appointmentFilter || undefined,
    sex: sexFilter || undefined,
    ageMin: ageMin ? Number(ageMin) : undefined,
    ageMax: ageMax ? Number(ageMax) : undefined,
    sortBy: sortBy,
    page,
    pageSize: 25
  }), [searchQuery, categoryFilter, appointmentFilter, sexFilter, ageMin, ageMax, sortBy, page]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["patient-directory", params],
    queryFn: () => fetchPatientDirectory(params),
    staleTime: 1000 * 30
  });

  if (isNewRoute) {
    return (
      <div className="w-full max-w-none space-y-5">
        <PatientForm mode="create" />
      </div>
    );
  }

  const patients = data?.patients || [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages || 1;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Button
            onClick={() => navigate("/patients/new")}
            className="w-full lg:w-auto shrink-0 rounded-2xl px-4 text-sm sm:text-[0.95rem]"
          >
            <UserPlus size={16} />
            <span className="leading-none">{t(language, "patients.registerTitle")}</span>
          </Button>
          <div className="relative flex-1">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center text-muted-foreground">
              <Search size={18} strokeWidth={1.5} />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder={t(language, "patients.searchPlaceholder")}
              className="input-premium pl-12 h-11 sm:h-12"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t(language, "patients.directory.filter.category")}:</span>
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value as CategoryFilter);
                setPage(1);
              }}
              className="input-premium h-9 text-sm"
            >
              <option value="">{t(language, "patients.directory.filter.all")}</option>
              <option value="oncology">{t(language, "patients.directory.filter.oncology")}</option>
              <option value="non_oncology">{t(language, "patients.directory.filter.nonOncology")}</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t(language, "patients.directory.filter.appointments")}:</span>
            <select
              value={appointmentFilter}
              onChange={(e) => {
                setAppointmentFilter(e.target.value as AppointmentFilter);
                setPage(1);
              }}
              className="input-premium h-9 text-sm"
            >
              <option value="">{t(language, "patients.directory.filter.all")}</option>
              <option value="has_future">{t(language, "patients.directory.filter.hasFuture")}</option>
              <option value="today">{t(language, "patients.directory.filter.today")}</option>
              <option value="no_future">{t(language, "patients.directory.filter.noFuture")}</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t(language, "patients.sex")}:</span>
            <select
              value={sexFilter}
              onChange={(e) => {
                setSexFilter(e.target.value as "male" | "female" | "");
                setPage(1);
              }}
              className="input-premium h-9 text-sm"
            >
              <option value="">{t(language, "patients.directory.filter.all")}</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t(language, "patients.age")}:</span>
            <input
              type="number"
              value={ageMin}
              onChange={(e) => {
                setAgeMin(e.target.value === "" ? "" : Number(e.target.value));
                setPage(1);
              }}
              placeholder="Min"
              className="input-premium h-9 w-16 text-sm"
              min="0"
            />
            <span className="text-muted-foreground">-</span>
            <input
              type="number"
              value={ageMax}
              onChange={(e) => {
                setAgeMax(e.target.value === "" ? "" : Number(e.target.value));
                setPage(1);
              }}
              placeholder="Max"
              className="input-premium h-9 w-16 text-sm"
              min="0"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as "name" | "recent" | "mrn");
                setPage(1);
              }}
              className="input-premium h-9 text-sm"
            >
              <option value="name">Name</option>
              <option value="recent">Most Recent</option>
              <option value="mrn">MRN</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-[0.15em] font-mono text-muted-foreground">
            {t(language, "patients.results")}
          </h3>
          <Badge variant="neutral" size="sm">
            {pagination ? t(language, "patients.directory.total", { count: String(pagination.total) }) : "..."}
          </Badge>
        </div>

        {isLoading ? (
          <div className="p-12 text-center">
            <div className="spinner-industrial h-8 w-8 mx-auto" />
            <p className="mt-4 text-sm text-muted-foreground">{t(language, "common.loading")}</p>
          </div>
        ) : isError ? (
          <div className="p-12 text-center">
            <p className="text-red-500">{t(language, "common.tryAgain")}</p>
          </div>
        ) : patients.length === 0 ? (
          <div className="p-12 text-center">
            <Search size={48} strokeWidth={1} className="mx-auto mb-4 text-muted-foreground opacity-30" />
            <p className="text-lg font-medium mb-2">{t(language, "patients.noResults")}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-start py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs">{t(language, "patients.mrn")}</th>
                    <th className="text-start py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs">{t(language, "patients.nameAr")}</th>
                    <th className="text-start py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs hidden lg:table-cell">{t(language, "patients.nameEn")}</th>
                    <th className="text-start py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs">{t(language, "patients.sex")}</th>
                    <th className="text-start py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs">{t(language, "patients.age")}</th>
                    <th className="text-start py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs hidden md:table-cell">{t(language, "patients.phone")}</th>
                    <th className="text-start py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs">{t(language, "patients.directory.nextAppointment")}</th>
                    <th className="text-start py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs">{t(language, "patients.directory.lastAppointment")}</th>
                    <th className="text-end py-3 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground text-xs">{t(language, "common.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {patients.map((patient: PatientDirectoryRow) => (
                    <tr
                      key={patient.id}
                      className="transition-colors duration-150 hover:bg-muted/50 cursor-pointer"
                      onClick={() => setSelectedPatientId(patient.id)}
                    >
                      <td className="p-3 font-mono text-xs">{patient.mrn || "—"}</td>
                      <td className="p-3 font-medium">
                        <div className="flex items-center gap-2">
                          <span className="truncate max-w-[150px]">{patient.arabicFullName}</span>
                          <PatientCategoryBadge category={patient.category} showWhenUnset={false} />
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(patient.warnings.missingPhone || patient.warnings.missingDob || patient.warnings.missingSex || patient.warnings.missingName || patient.warnings.noAppointment || patient.warnings.possibleDuplicate) && (
                            <>
                              {patient.warnings.missingPhone && (
                                <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                  <Phone size={8} className="mr-1" />
                                </span>
                              )}
                              {patient.warnings.missingDob && (
                                <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                  DOB
                                </span>
                              )}
                              {patient.warnings.missingSex && (
                                <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                  <User size={8} className="mr-1" />
                                </span>
                              )}
                              {patient.warnings.possibleDuplicate && (
                                <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                  <AlertTriangle size={8} className="mr-1" />
                                </span>
                              )}
                              {patient.warnings.noAppointment && (
                                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                                  <Calendar size={8} className="mr-1" />
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground hidden lg:table-cell">{patient.englishFullName || "—"}</td>
                      <td className="p-3 text-muted-foreground">{patient.sex || "—"}</td>
                      <td className="p-3 text-muted-foreground">{patient.ageYears}{patient.demographicsEstimated ? " (E)" : ""}</td>
                      <td className="p-3 text-muted-foreground hidden md:table-cell font-mono text-xs">{patient.phone1 || "—"}</td>
                      <td className="p-3 text-muted-foreground">
                        {patient.nextAppointment ? (
                          <div>
                            <div className="text-xs">{patient.nextAppointment.date}</div>
                            <div className="text-xs text-muted-foreground">{patient.nextAppointment.modalityName}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {patient.lastAppointment ? (
                          <div>
                            <div className="text-xs">{patient.lastAppointment.date}</div>
                            <div className="text-xs text-muted-foreground">{patient.lastAppointment.modalityName}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/patients/${patient.id}/edit`)}
                            style={{ color: "var(--accent)" }}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/appointments?patientId=${patient.id}`)}
                          >
                            <CalendarPlus size={14} />
                          </Button>
                          {patient.lastAppointment && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/print?appointmentId=${patient.lastAppointment!.id}`)}
                            >
                              <Printer size={14} />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between p-4 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={16} />
                  {language === "ar" ? "السابق" : "Previous"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t(language, "patients.directory.pagination", { page: String(page), total: String(totalPages) })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {language === "ar" ? "التالي" : "Next"}
                  <ChevronRight size={16} />
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {selectedPatientId && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSelectedPatientId(null)}>
          <div className="fixed inset-y-0 right-0" onClick={(e) => e.stopPropagation()}>
            <PatientDrawer patientId={selectedPatientId} onClose={() => setSelectedPatientId(null)} />
          </div>
        </div>
      )}
    </div>
  );
}