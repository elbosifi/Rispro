import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchPatients } from "@/lib/api-hooks";
import PatientForm from "@/components/patients/patient-form";
import { Patient } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { ArrowLeft, UserPlus, Search, Pencil, CalendarPlus } from "lucide-react";

function CornerScrews() {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <div className="absolute top-3 left-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />
      <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, rgba(0,0,0,0.18) 1.5px, transparent 2px)" }} />
    </div>
  );
}

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
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/patients")}
            className="btn-secondary text-xs"
          >
            <ArrowLeft size={16} />
            {t(language, "common.back")}
          </button>
          <h2 className="text-xl font-bold text-embossed" style={{ color: "var(--text)" }}>
            {t(language, "patients.registerTitle")}
          </h2>
        </div>
        <PatientForm mode="create" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-embossed" style={{ color: "var(--text)" }}>
            {t(language, "patients.title")}
          </h2>
          <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
            Patient Management
          </p>
        </div>
        <button
          onClick={() => navigate("/patients/new")}
          className="btn-primary text-xs"
        >
          <UserPlus size={16} />
          {t(language, "patients.registerTitle")}
        </button>
      </div>

      {/* Search */}
      <div className="card-shell relative">
        <CornerScrews />
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center" style={{ color: "var(--text-muted)" }}>
            <Search size={18} strokeWidth={1.5} />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(language, "patients.searchPlaceholder")}
            className="input-premium pl-10"
          />
        </div>
      </div>

      {/* Results */}
      <div className="card-shell relative overflow-hidden">
        <CornerScrews />
        <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-bold uppercase tracking-[0.08em]" style={{ color: "var(--text)" }}>
            {t(language, "patients.results")}
          </h3>
          <span className="pill-soft text-[10px] font-mono-data">{patients.length}</span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">
            <div className="spinner-industrial h-8 w-8 mx-auto" />
            <p className="mt-3 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>{t(language, "common.loading")}</p>
          </div>
        ) : patients.length === 0 ? (
          <div className="p-8 text-center">
            <Search size={32} strokeWidth={1} className="mx-auto mb-3" style={{ color: "var(--text-muted)", opacity: 0.3 }} />
            <p className="text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
              {searchQuery.length < 2
                ? t(language, "patients.typeToSearch")
                : t(language, "patients.noResults")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono-data">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                  <th className="text-start py-2 px-3 font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{t(language, "patients.nameAr")}</th>
                  <th className="text-start py-2 px-3 font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{t(language, "patients.nameEn")}</th>
                  <th className="text-start py-2 px-3 font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{t(language, "patients.nationalId")}</th>
                  <th className="text-start py-2 px-3 font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{t(language, "patients.mrn")}</th>
                  <th className="text-start py-2 px-3 font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{t(language, "patients.sex")}</th>
                  <th className="text-start py-2 px-3 font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{t(language, "patients.age")}</th>
                  <th className="text-start py-2 px-3 font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{t(language, "patients.phone")}</th>
                  <th className="text-end py-2 px-3 font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-muted)" }}>{t(language, "common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {patients.map((patient: Patient) => (
                  <tr key={patient.id} className="transition-colors duration-150 hover:bg-[var(--foreground)]">
                    <td className="p-3 font-medium" style={{ color: "var(--text)" }}>{patient.arabicFullName}</td>
                    <td className="p-3" style={{ color: "var(--text-muted)" }}>{patient.englishFullName || "—"}</td>
                    <td className="p-3" style={{ color: "var(--text-muted)" }}>{patient.nationalId || "—"}</td>
                    <td className="p-3" style={{ color: "var(--text-muted)" }}>{patient.mrn || "—"}</td>
                    <td className="p-3" style={{ color: "var(--text-muted)" }}>{patient.sex || "—"}</td>
                    <td className="p-3" style={{ color: "var(--text-muted)" }}>
                      {patient.ageYears != null
                        ? `${patient.ageYears}${patient.demographicsEstimated ? " (Estimated)" : ""}`
                        : "—"}
                    </td>
                    <td className="p-3" style={{ color: "var(--text-muted)" }}>{patient.phone1 || "—"}</td>
                    <td className="p-3">
                      <div className="flex gap-1.5 justify-end">
                        <button
                          onClick={() => navigate(`/patients/${patient.id}/edit`)}
                          className="btn-ghost text-xs py-1.5 px-2 min-h-[32px]"
                          style={{ color: "var(--accent)" }}
                        >
                          <Pencil size={14} />
                          {t(language, "common.edit")}
                        </button>
                        <button
                          onClick={() => navigate(`/appointments?patientId=${patient.id}`)}
                          className="btn-ghost text-xs py-1.5 px-2 min-h-[32px]"
                        >
                          <CalendarPlus size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
