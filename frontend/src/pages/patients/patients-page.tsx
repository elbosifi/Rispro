import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { searchPatients } from "@/lib/api-hooks";
import PatientForm from "@/components/patients/patient-form";
import { Patient } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";

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
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate("/patients")}
            className="px-4 py-2 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 font-medium rounded-lg transition-colors text-sm"
          >
            {t(language, "common.back")} - {t(language, "patients.backToPatients")}
          </button>
          <h2 className="text-2xl font-bold text-stone-900 dark:text-white">{t(language, "patients.registerTitle")}</h2>
        </div>
        <PatientForm mode="create" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
          {t(language, "patients.title")}
        </h2>
        <button
          onClick={() => navigate("/patients/new")}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg transition-colors text-sm"
        >
          {t(language, "patients.registerTitle")}
        </button>
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t(language, "patients.searchPlaceholder")}
          className="w-full px-4 py-3 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
        />
      </div>

      {/* Results */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">
            {t(language, "patients.results")} ({patients.length})
          </h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-stone-500">{t(language, "common.loading")}</div>
        ) : patients.length === 0 ? (
          <div className="p-8 text-center text-stone-500">
            {searchQuery.length < 2
              ? t(language, "patients.typeToSearch")
              : t(language, "patients.noResults")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
                <tr>
                  <th className="text-right p-3">{t(language, "patients.nameAr")}</th>
                  <th className="text-right p-3">{t(language, "patients.nameEn")}</th>
                  <th className="text-right p-3">{t(language, "patients.nationalId")}</th>
                  <th className="text-right p-3">{t(language, "patients.mrn")}</th>
                  <th className="text-right p-3">{t(language, "patients.sex")}</th>
                  <th className="text-right p-3">{t(language, "patients.age")}</th>
                  <th className="text-right p-3">{t(language, "patients.phone")}</th>
                  <th className="text-right p-3">{t(language, "common.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                {patients.map((patient: Patient) => (
                  <tr key={patient.id} className="hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors">
                    <td className="p-3 text-stone-900 dark:text-white font-medium">{patient.arabicFullName}</td>
                    <td className="p-3 text-stone-700 dark:text-stone-300">{patient.englishFullName || "—"}</td>
                    <td className="p-3 text-stone-700 dark:text-stone-300">{patient.nationalId || "—"}</td>
                    <td className="p-3 text-stone-700 dark:text-stone-300">{patient.mrn || "—"}</td>
                    <td className="p-3 text-stone-700 dark:text-stone-300">{patient.sex || "—"}</td>
                    <td className="p-3 text-stone-700 dark:text-stone-300">{patient.ageYears ?? "—"}</td>
                    <td className="p-3 text-stone-700 dark:text-stone-300">{patient.phone1 || "—"}</td>
                    <td className="p-3">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => navigate(`/patients/${patient.id}/edit`)}
                          className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium rounded transition-colors"
                        >
                          {t(language, "common.edit")}
                        </button>
                        <button
                          onClick={() => navigate(`/appointments?patientId=${patient.id}`)}
                          className="px-3 py-1 bg-stone-600 hover:bg-stone-700 text-white text-xs font-medium rounded transition-colors"
                        >
                          {t(language, "patients.newAppointment")}
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
