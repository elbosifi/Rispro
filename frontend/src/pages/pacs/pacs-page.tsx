import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

interface PacsNode {
  id: number;
  name: string;
  is_active: boolean;
  is_default: boolean;
}

export default function PacsPage() {
  const { language } = useLanguage();
  const queryClient = useQueryClient();

  // Search criteria
  const [nationalId, setNationalId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [accessionNumber, setAccessionNumber] = useState("");
  const [studyDate, setStudyDate] = useState("");
  const [modality, setModality] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  const [searchResults, setSearchResults] = useState<PacsStudy[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<{ id: number; name: string } | null>(null);

  // Fetch available PACS nodes
  const { data: nodesData } = useQuery<{ nodes: PacsNode[] }>({
    queryKey: ["pacs", "nodes"],
    queryFn: async () => {
      const resp = await fetch("/api/pacs/nodes");
      if (!resp.ok) throw new Error("Failed to fetch PACS nodes");
      return resp.json();
    }
  });

  const searchMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      const cleanedNationalId = nationalId.replace(/\D/g, "").trim();

      if (cleanedNationalId) body.patientNationalId = cleanedNationalId;
      if (patientName.trim()) body.patientName = patientName.trim();
      if (accessionNumber.trim()) body.accessionNumber = accessionNumber.trim();
      if (studyDate) body.studyDate = studyDate;
      if (modality) body.modality = modality;
      if (selectedNodeId) body.nodeId = selectedNodeId;

      return api<{ studies: PacsStudy[]; node?: { id: number; name: string } }>("/pacs/search", {
        method: "POST",
        body: JSON.stringify(body)
      });
    },
    onSuccess: (data) => {
      setSearchResults(data.studies ?? []);
      setSelectedNode(data.node ?? null);
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

    const hasCriteria =
      nationalId.replace(/\D/g, "").trim() ||
      patientName.trim() ||
      accessionNumber.trim() ||
      studyDate ||
      modality;

    if (!hasCriteria) {
      setError(t(language, "pacs.atLeastOneField"));
      return;
    }

    setIsSearching(true);
    setError("");
    setSearchResults([]);
    setSelectedNode(null);
    searchMutation.mutate();
  };

  const handleReset = () => {
    setNationalId("");
    setPatientName("");
    setAccessionNumber("");
    setStudyDate("");
    setModality("");
    setSelectedNodeId(null);
    setSearchResults([]);
    setError("");
    setSelectedNode(null);
  };

  const activeNodes = (nodesData?.nodes ?? []).filter((n) => n.is_active);
  const defaultNode = activeNodes.find((n) => n.is_default);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">{t(language, "pacs.title")}</h2>

      {/* Search Form */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
        <form onSubmit={handleSearch} className="space-y-4">
          {/* Primary search: National ID */}
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              {t(language, "pacs.fieldNationalId")}
            </label>
            <input
              type="text"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value.replace(/\D/g, "").slice(0, 11))}
              placeholder={t(language, "pacs.placeholder")}
              inputMode="numeric"
              maxLength={11}
              className="w-full px-4 py-2.5 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
            />
          </div>

          {/* Advanced criteria */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                {t(language, "pacs.fieldPatientName")}
              </label>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder={t(language, "pacs.patientNamePlaceholder")}
                className="w-full px-4 py-2.5 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                {t(language, "pacs.fieldAccessionNumber")}
              </label>
              <input
                type="text"
                value={accessionNumber}
                onChange={(e) => setAccessionNumber(e.target.value)}
                placeholder={t(language, "pacs.accessionPlaceholder")}
                className="w-full px-4 py-2.5 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                {t(language, "pacs.fieldStudyDate")}
              </label>
              <input
                type="date"
                value={studyDate}
                onChange={(e) => setStudyDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                {t(language, "pacs.fieldModality")}
              </label>
              <select
                value={modality}
                onChange={(e) => setModality(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
              >
                <option value="">{t(language, "pacs.allModalities")}</option>
                <option value="CT">CT</option>
                <option value="MR">MRI</option>
                <option value="CR">CR</option>
                <option value="DX">DX</option>
                <option value="US">Ultrasound</option>
                <option value="RF">RF</option>
                <option value="MG">Mammography</option>
                <option value="PT">PET</option>
                <option value="NM">Nuclear Medicine</option>
                <option value="XA">X-Ray Angio</option>
              </select>
            </div>
          </div>

          {/* PACS Node selector */}
          {activeNodes.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                {t(language, "pacs.fieldPacsNode")}
              </label>
              <select
                value={selectedNodeId ?? ""}
                onChange={(e) => setSelectedNodeId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full px-4 py-2.5 rounded-xl border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
              >
                <option value="">{defaultNode ? `${defaultNode.name} (default)` : t(language, "pacs.defaultNode")}</option>
                {activeNodes.filter((n) => !n.is_default).map((node) => (
                  <option key={node.id} value={node.id}>{node.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSearching}
              className="flex-1 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors"
            >
              {isSearching ? t(language, "pacs.searching") : t(language, "pacs.searchBtn")}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-6 py-2.5 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 font-medium rounded-xl transition-colors"
            >
              {t(language, "pacs.resetBtn") || "Reset"}
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </form>
      </div>

      {/* Results */}
      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
          <h3 className="font-semibold text-stone-900 dark:text-white">
            {t(language, "pacs.studies", { count: searchResults.length })}
          </h3>
          {selectedNode && (
            <span className="text-xs text-stone-500 dark:text-stone-400">
              Node: {selectedNode.name}
            </span>
          )}
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
                  <div className="flex-1">
                    <p className="font-medium text-stone-900 dark:text-white">
                      {study.patientName || study.patientId || t(language, "pacs.studyLabel", { num: index + 1 })}
                    </p>
                    <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                      {t(language, "pacs.fieldDate")}: {study.studyDate || "—"} • {t(language, "pacs.fieldModality")}: {study.modality || "—"}
                    </p>
                    <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
                      {t(language, "pacs.fieldDescription")}: {study.description || "—"}
                    </p>
                    {study.accessionNumber && (
                      <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 font-mono">
                        Acc: {study.accessionNumber}
                      </p>
                    )}
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
