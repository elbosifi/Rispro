import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchQueueSnapshot, scanIntoQueue, addWalkIn, confirmNoShow, searchPatients } from "@/lib/api-hooks";
import type { QueueSnapshot } from "@/types/api";
import { todayIsoDateLy } from "@/lib/date-format";

export default function QueuePage() {
  const [scanValue, setScanValue] = useState("");
  const [walkInSearch, setWalkInSearch] = useState("");
  const [walkInResults, setWalkInResults] = useState<any[]>([]);
  const [selectedWalkIn, setSelectedWalkIn] = useState<any>(null);
  const queryClient = useQueryClient();

  // Load queue snapshot
  const { data: queue } = useQuery<QueueSnapshot>({
    queryKey: ["queue"],
    queryFn: fetchQueueSnapshot,
    refetchInterval: 1000 * 10
  });

  // Scan into queue mutation
  const scanMutation = useMutation({
    mutationFn: scanIntoQueue,
    onSuccess: () => {
      setScanValue("");
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      alert("Patient scanned into queue successfully!");
    },
    onError: (err: any) => {
      alert(err.message || "Scan failed");
    }
  });

  // Walk-in search
  const handleWalkInSearch = (query: string) => {
    setWalkInSearch(query);
    if (query.length > 1) {
      searchPatients(query).then(setWalkInResults);
    } else {
      setWalkInResults([]);
    }
  };

  // Create walk-in mutation
  const walkInMutation = useMutation({
    mutationFn: addWalkIn,
    onSuccess: () => {
      setSelectedWalkIn(null);
      setWalkInSearch("");
      setWalkInResults([]);
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      alert("Walk-in patient added to queue!");
    }
  });

  // Confirm no-show mutation
  const noShowMutation = useMutation({
    mutationFn: ({ appointmentId, reason }: { appointmentId: number; reason: string }) =>
      confirmNoShow(appointmentId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    }
  });

  const handleScan = (e: FormEvent) => {
    e.preventDefault();
    if (scanValue.trim()) {
      scanMutation.mutate(scanValue.trim());
    }
  };

  const handleWalkInSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (selectedWalkIn) {
      walkInMutation.mutate({
        patientId: selectedWalkIn.id,
        modalityId: "",
        appointmentDate: todayIsoDateLy(),
        isWalkIn: true
      });
    }
  };

  const handleNoShow = (appointmentId: number) => {
    noShowMutation.mutate({ appointmentId, reason: "Patient did not arrive" });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
        Queue & Arrival
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Scan & Walk-in */}
        <div className="space-y-6">
          {/* Scan */}
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-stone-900 dark:text-white mb-4">
              Scan Accession
            </h3>
            <form onSubmit={handleScan} className="flex gap-2">
              <input
                type="text"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                placeholder="Scan barcode or type accession..."
                className="flex-1 px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
              />
              <button
                type="submit"
                disabled={scanMutation.isPending || !scanValue.trim()}
                className="px-6 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-lg transition-colors"
              >
                Scan
              </button>
            </form>
          </div>

          {/* Walk-in */}
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
            <h3 className="text-lg font-semibold text-stone-900 dark:text-white mb-4">
              Walk-in Patient
            </h3>
            <div className="relative mb-4">
              <input
                type="text"
                value={walkInSearch}
                onChange={(e) => handleWalkInSearch(e.target.value)}
                placeholder="Search patient..."
                className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
              />
              {walkInResults.length > 0 && (
                <ul className="absolute z-10 w-full mt-1 bg-white dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {walkInResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedWalkIn(p);
                          setWalkInResults([]);
                          setWalkInSearch(p.arabicFullName);
                        }}
                        className="w-full text-right p-3 hover:bg-stone-50 dark:hover:bg-stone-600"
                      >
                        <p className="font-medium text-stone-900 dark:text-white">
                          {p.arabicFullName}
                        </p>
                        <p className="text-xs text-stone-500">{p.nationalId || "No ID"}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {selectedWalkIn && (
              <div className="mb-4 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg">
                <p className="text-sm font-medium text-teal-800 dark:text-teal-300">
                  Selected: {selectedWalkIn.arabicFullName}
                </p>
              </div>
            )}
            <button
              onClick={handleWalkInSubmit}
              disabled={walkInMutation.isPending || !selectedWalkIn}
              className="w-full py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-medium rounded-lg transition-colors"
            >
              {walkInMutation.isPending ? "Adding..." : "Add to Queue"}
            </button>
          </div>
        </div>

        {/* Right: Queue List */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-stone-200 dark:border-stone-700 flex justify-between items-center">
              <h3 className="font-semibold text-stone-900 dark:text-white">
                Today's Queue
              </h3>
              {queue && (
                <div className="flex gap-3 text-sm text-stone-500 dark:text-stone-400">
                  <span>Waiting: {queue.summary.waiting_count}</span>
                  <span>No-shows: {queue.summary.no_show_count}</span>
                </div>
              )}
            </div>

            {queue?.queueEntries.length === 0 ? (
              <div className="p-8 text-center text-stone-500">No patients in queue</div>
            ) : (
              <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
                {queue?.queueEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="p-4 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-700/50"
                  >
                    <div>
                      <p className="font-medium text-stone-900 dark:text-white">
                        {entry.arabicFullName}
                      </p>
                      <p className="text-sm text-stone-500 dark:text-stone-400">
                        #{entry.queueNumber} • {entry.accessionNumber}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          entry.queueStatus === "waiting"
                            ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                            : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"
                        }`}
                      >
                        {entry.queueStatus}
                      </span>
                      {queue.reviewActive && entry.appointmentStatus === "scheduled" && (
                        <button
                          onClick={() => handleNoShow(entry.appointmentId)}
                          className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900/50"
                        >
                          Mark No-show
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
