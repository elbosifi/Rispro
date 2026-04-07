import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";

export interface PacsStudy {
  studyDate?: string;
  modality?: string;
  description?: string;
  patientId?: string;
  patientName?: string;
  accessionNumber?: string;
  studyInstanceUid?: string;
}

export default function PacsPage() {
  const { language } = useLanguage();
  const [nationalId, setNationalId] = useState("");
  const [searchResults, setSearchResults] = useState<PacsStudy[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  const searchMutation = useMutation({
    mutationFn: (id: string) =>
      api<{ studies: PacsStudy[] }>("/integrations/pacs-search", {
        method: "POST",
        body: JSON.stringify({ patientNationalId: id })
      }),
    onSuccess: (data) => {
      setSearchResults(data.studies ?? []);
      setIsSearching(false);
    },
    onError: (err: unknown) => {
      const message = err instanceof ApiError ? err.message : t(language, "pacs.searchFailed");
      setError(message);
      setIsSearching(false);
    }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nationalId.replace(/\D/g, "").trim();
    if (!cleaned) return;
    if (cleaned.length !== 11) {
      setError(t(language, "pacs.invalidId"));
      return;
    }
    setIsSearching(true);
    setError("");
    searchMutation.mutate(cleaned);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">{t(language, "pacs.title")}</h2>

      {/* Search Form */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
        <form onSubmit={handleSearch} className="flex gap-4">
          <input
            type="text"
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value.replace(/\D/g, "").slice(0, 11))}
            placeholder={t(language, "pacs.placeholder")}
            inputMode="numeric"
            maxLength={11}
            className="flex-1 px-4 py-3 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
          />
          <button
            type="submit"
            disabled={isSearching || !nationalId.trim()}
            className="px-6 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors"
          >
            {isSearching ? t(language, "pacs.searching") : t(language, "pacs.searchBtn")}
          </button>
        </form>
        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>

      {/* Results */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">
            {t(language, "pacs.studies", { count: searchResults.length })}
          </h3>
        </div>
        {isSearching ? (
          <div className="p-8 text-center text-stone-500">{t(language, "pacs.searchingPacs")}</div>
        ) : searchResults.length === 0 ? (
          <div className="p-8 text-center text-stone-500">{t(language, "pacs.noStudies")}</div>
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
            {searchResults.map((study, index) => (
              <li key={index} className="p-4 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="text-right flex-1">
                    <p className="font-medium text-stone-900 dark:text-white">
                      {t(language, "pacs.studyLabel", { num: index + 1 })}
                    </p>
                    <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                      {t(language, "pacs.fieldDate")}: {study.studyDate || "—"} • {t(language, "pacs.fieldModality")}: {study.modality || "—"}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                      {t(language, "pacs.fieldDescription")}: {study.description || "—"}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
