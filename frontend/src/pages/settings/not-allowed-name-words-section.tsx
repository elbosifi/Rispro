import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/shared/Button";
import {
  deletePatientNotAllowedNameWord,
  fetchPatientNotAllowedNameWords,
  upsertPatientNotAllowedNameWord,
} from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";
import { mutationErrorMessage } from "./settings-section-utils";

export default function NotAllowedNameWordsSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["patient-not-allowed-name-words"],
    queryFn: fetchPatientNotAllowedNameWords
  });
  const [arabicText, setArabicText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const isReauthError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err || "");
    return message.includes("re-authentication") || message.includes("403");
  };

  const addMutation = useMutation({
    mutationFn: (word: string) => upsertPatientNotAllowedNameWord(word),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-not-allowed-name-words"] });
      setArabicText("");
      setMutationError(null);
    },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["patient-not-allowed-name-words"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Save failed"));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePatientNotAllowedNameWord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-not-allowed-name-words"] });
      setMutationError(null);
    },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["patient-not-allowed-name-words"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Delete failed"));
    }
  });

  if (error) {
    const msg = (error as Error).message;
    if (isReauthError(error)) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["patient-not-allowed-name-words"])} />;
    return <QueryError message={msg} />;
  }

  const allEntries = data?.entries ?? [];
  const filteredEntries = searchQuery
    ? allEntries.filter((entry) => entry.arabicText.includes(searchQuery))
    : allEntries;

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const word = arabicText.trim();
          if (!word) return;
          addMutation.mutate(word);
        }}
      >
        <input
          value={arabicText}
          onChange={(event) => setArabicText(event.target.value)}
          placeholder="Arabic word"
          className="input-premium input-rtl flex-1"
        />
        <Button type="submit" disabled={addMutation.isPending || !arabicText.trim()}>
          {addMutation.isPending ? "Saving..." : "Add word"}
        </Button>
      </form>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search Arabic word..."
          className="input-premium input-rtl flex-1 min-w-[200px]"
        />
        <span className="text-sm description-center">{filteredEntries.length} / {allEntries.length} entries</span>
      </div>

      {isLoading ? <p className="description-center">{t("settings.loading")}</p> : (
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400 sticky top-0">
              <tr>
                <th className="text-start p-2">Arabic word</th>
                <th className="p-2 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {filteredEntries.length === 0 ? (
                <tr><td colSpan={2} className="p-8 text-center text-stone-500 dark:text-stone-400">No not-allowed words</td></tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-stone-50 dark:hover:bg-stone-700/30 transition-colors">
                    <td className="p-2 text-stone-900 dark:text-white input-rtl">{entry.arabicText}</td>
                    <td className="p-2 text-center">
                      <button
                        onClick={() => { if (window.confirm(`Delete "${entry.arabicText}"?`)) deleteMutation.mutate(entry.id); }}
                        className="px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
