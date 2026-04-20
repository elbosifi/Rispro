import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchPatients } from "@/lib/api-hooks";
import PatientForm from "@/components/patients/patient-form";
import { Patient } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { ArrowLeft, UserPlus, Search, Pencil, CalendarPlus } from "lucide-react";
import { Button, Card, SectionLabel, Badge } from "@/components/shared";

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
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Button
              variant="secondary"
              onClick={() => navigate("/patients")}
            >
              <ArrowLeft size={16} />
              {t(language, "common.back")}
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <SectionLabel>PATIENT REGISTRATION</SectionLabel>
          </div>
          <h1 className="text-3xl font-display" style={{ color: "var(--foreground)" }}>
            Register <span className="gradient-text">Patient</span>
          </h1>
        </div>
        <PatientForm mode="create" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <SectionLabel>PATIENT MANAGEMENT</SectionLabel>
        </div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display" style={{ color: "var(--foreground)" }}>
              Patient <span className="gradient-text">Directory</span>
            </h1>
            <p className="mt-2 text-muted-foreground">
              Search, view, and manage patient records
            </p>
          </div>
          <Button
            onClick={() => navigate("/patients/new")}
          >
            <UserPlus size={16} />
            {t(language, "patients.registerTitle")}
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card className="p-6">
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center text-muted-foreground">
            <Search size={18} strokeWidth={1.5} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(language, "patients.searchPlaceholder")}
            className="input-premium pl-12"
          />
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
                ? "Start typing to search"
                : "No patients found"}
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
