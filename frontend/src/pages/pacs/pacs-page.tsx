import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export default function PacsPage() {
  const [nationalId, setNationalId] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  const searchMutation = useMutation({
    mutationFn: (id: string) =>
      api("/integrations/pacs-search", {
        method: "POST",
        body: JSON.stringify({ patientNationalId: id })
      }),
    onSuccess: (data: any) => {
      setSearchResults(data.studies ?? []);
      setIsSearching(false);
    },
    onError: (err: any) => {
      setError(err.message || "Search failed");
      setIsSearching(false);
    }
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nationalId.trim()) return;
    setIsSearching(true);
    setError("");
    searchMutation.mutate(nationalId.trim());
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">PACS Search</h2>

      {/* Search Form */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
        <form onSubmit={handleSearch} className="flex gap-4">
          <input
            type="text"
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
            placeholder="Enter Patient National ID..."
            className="flex-1 px-4 py-3 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
          />
          <button
            type="submit"
            disabled={isSearching || !nationalId.trim()}
            className="px-6 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors"
          >
            {isSearching ? "Searching..." : "Search PACS"}
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
            Studies ({searchResults.length})
          </h3>
        </div>
        {isSearching ? (
          <div className="p-8 text-center text-stone-500">Searching PACS...</div>
        ) : searchResults.length === 0 ? (
          <div className="p-8 text-center text-stone-500">No studies found. Enter a National ID to search.</div>
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
            {searchResults.map((study: any, index: number) => (
              <li key={index} className="p-4 hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="text-right flex-1">
                    <p className="font-medium text-stone-900 dark:text-white">
                      Study #{index + 1}
                    </p>
                    <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                      Date: {study.studyDate || "—"} • Modality: {study.modality || "—"}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                      Description: {study.description || "—"}
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
