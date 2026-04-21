import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchPatients } from "@/lib/api-hooks";
import PatientForm from "@/components/patients/patient-form";
import { Patient } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { UserPlus, Search, Pencil, CalendarPlus } from "lucide-react";
import { Button, Card, Badge } from "@/components/shared";

export default function PatientsPage() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const isNewRoute = location.pathname === "/patients/new" || location.pathname.startsWith("/patients/new");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: patients = [], isLoading } = useQuery({
    queryKey: ["patients-list", searchQuery],
    queryFn: () => searchPatients(searchQuery),
    staleTime: 1000 * 30,
    enabled: searchQuery.length >= 2 && !isNewRoute
  });

  if (isNewRoute) {
    return (
      <div className="max-w-4xl mx-auto space-y-5">
        <PatientForm mode="create" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Search */}
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
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(language, "patients.searchPlaceholder")}
              className="input-premium pl-12 h-11 sm:h-12"
            />
          </div>
        </div>
      </Card>

      {/* Results */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-[0.15em] font-mono text-muted-foreground">
            {t(language, "patients.results")}
          </h3>
          <Badge variant="neutral" size="sm">
            {patients.length}
          </Badge>
        </div>

        {isLoading ? (
          <div className="p-12 text-center">
            <div className="spinner-industrial h-8 w-8 mx-auto" />
            <p className="mt-4 text-sm text-muted-foreground">{t(language, "common.loading")}</p>
          </div>
        ) : patients.length === 0 ? (
          <div className="p-12 text-center">
            <Search size={48} strokeWidth={1} className="mx-auto mb-4 text-muted-foreground opacity-30" />
            <p className="text-lg font-medium mb-2">
              {searchQuery.length < 2
                ? t(language, "patients.typeToSearch")
                : t(language, "patients.noResults")}
            </p>
            <p className="text-sm text-muted-foreground">
              {searchQuery.length < 2
                ? t(language, "patients.typeToSearch")
                : t(language, "patients.noResults")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-start py-4 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t(language, "patients.nameAr")}</th>
                  <th className="text-start py-4 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t(language, "patients.nameEn")}</th>
                  <th className="text-start py-4 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t(language, "patients.nationalId")}</th>
                  <th className="text-start py-4 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t(language, "patients.mrn")}</th>
                  <th className="text-start py-4 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t(language, "patients.sex")}</th>
                  <th className="text-start py-4 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t(language, "patients.age")}</th>
                  <th className="text-start py-4 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t(language, "patients.phone")}</th>
                  <th className="text-end py-4 px-4 font-semibold uppercase tracking-[0.15em] font-mono text-muted-foreground">{t(language, "common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {patients.map((patient: Patient) => (
                  <tr key={patient.id} className="transition-colors duration-150 hover:bg-muted/50">
                    <td className="p-4 font-medium">{patient.arabicFullName}</td>
                    <td className="p-4 text-muted-foreground">{patient.englishFullName || "—"}</td>
                    <td className="p-4 text-muted-foreground font-mono">{patient.nationalId || "—"}</td>
                    <td className="p-4 text-muted-foreground font-mono">{patient.mrn || "—"}</td>
                    <td className="p-4 text-muted-foreground">{patient.sex || "—"}</td>
                    <td className="p-4 text-muted-foreground">
                      {patient.ageYears != null
                        ? `${patient.ageYears}${patient.demographicsEstimated ? " (Estimated)" : ""}`
                        : "—"}
                    </td>
                    <td className="p-4 text-muted-foreground">{patient.phone1 || "—"}</td>
                    <td className="p-4">
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/patients/${patient.id}/edit`)}
                          style={{ color: "var(--accent)" }}
                        >
                          <Pencil size={14} />
                          {t(language, "common.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/appointments?patientId=${patient.id}`)}
                        >
                          <CalendarPlus size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
