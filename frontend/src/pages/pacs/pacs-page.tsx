import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { Search, RefreshCw, Monitor, Calendar, Activity, FileText, Hash } from "lucide-react";

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
    queryKey: ["pacs", "available-nodes"],
    queryFn: () => api<{ nodes: PacsNode[] }>("/pacs/nodes/available")
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
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--accent)" }}>
          <Monitor className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-embossed" style={{ color: "var(--text)" }}>
            {t(language, "pacs.title")}
          </h2>
          <p className="mt-1 text-xs font-mono-data" style={{ color: "var(--text-muted)" }}>
            {t(language, "pacs.searchBtn")}
          </p>
        </div>
      </div>

      {/* Search Form */}
      <div className="card-shell relative p-6">

        <form onSubmit={handleSearch} className="space-y-4">
          {/* Primary search: National ID */}
          <div>
            <label className="block text-xs font-mono-data uppercase tracking-[0.06em] mb-1" style={{ color: "var(--text-muted)" }}>
              <Hash className="w-3 h-3 inline mr-1" />
              {t(language, "pacs.fieldNationalId")}
            </label>
            <input
              type="text"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value.replace(/\D/g, "").slice(0, 12))}
              placeholder={t(language, "pacs.placeholder")}
              inputMode="numeric"
              maxLength={12}
              className="input-premium w-full px-4 py-2.5 rounded-lg outline-none font-mono-data"
              style={{ color: "var(--text)" }}
            />
          </div>

          {/* Advanced criteria */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono-data uppercase tracking-[0.06em] mb-1" style={{ color: "var(--text-muted)" }}>
                <Monitor className="w-3 h-3 inline mr-1" />
                {t(language, "pacs.fieldPatientName")}
              </label>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder={t(language, "pacs.patientNamePlaceholder")}
                className="input-premium w-full px-4 py-2.5 rounded-lg outline-none font-mono-data"
                style={{ color: "var(--text)" }}
              />
            </div>

            <div>
              <label className="block text-xs font-mono-data uppercase tracking-[0.06em] mb-1" style={{ color: "var(--text-muted)" }}>
                <FileText className="w-3 h-3 inline mr-1" />
                {t(language, "pacs.fieldAccessionNumber")}
              </label>
              <input
                type="text"
                value={accessionNumber}
                onChange={(e) => setAccessionNumber(e.target.value)}
                placeholder={t(language, "pacs.accessionPlaceholder")}
                className="input-premium w-full px-4 py-2.5 rounded-lg outline-none font-mono-data"
                style={{ color: "var(--text)" }}
              />
            </div>

            <div>
              <label className="block text-xs font-mono-data uppercase tracking-[0.06em] mb-1" style={{ color: "var(--text-muted)" }}>
                <Calendar className="w-3 h-3 inline mr-1" />
                {t(language, "pacs.fieldStudyDate")}
              </label>
              <input
                type="date"
                value={studyDate}
                onChange={(e) => setStudyDate(e.target.value)}
                className="input-premium w-full px-4 py-2.5 rounded-lg outline-none font-mono-data"
                style={{ color: "var(--text)" }}
              />
            </div>

            <div>
              <label className="block text-xs font-mono-data uppercase tracking-[0.06em] mb-1" style={{ color: "var(--text-muted)" }}>
                <Activity className="w-3 h-3 inline mr-1" />
                {t(language, "pacs.fieldModality")}
              </label>
              <select
                value={modality}
                onChange={(e) => setModality(e.target.value)}
                className="input-premium w-full px-4 py-2.5 rounded-lg outline-none font-mono-data"
                style={{ color: "var(--text)" }}
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
              <label className="block text-xs font-mono-data uppercase tracking-[0.06em] mb-1" style={{ color: "var(--text-muted)" }}>
                <Monitor className="w-3 h-3 inline mr-1" />
                {t(language, "pacs.fieldPacsNode")}
              </label>
              <select
                value={selectedNodeId ?? ""}
                onChange={(e) => setSelectedNodeId(e.target.value ? parseInt(e.target.value) : null)}
                className="input-premium w-full px-4 py-2.5 rounded-lg outline-none font-mono-data"
                style={{ color: "var(--text)" }}
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
              className="btn-primary flex-1 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              <Search className="w-4 h-4" />
              {isSearching ? t(language, "pacs.searching") : t(language, "pacs.searchBtn")}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="btn-secondary px-6 py-2.5 rounded-lg font-medium flex items-center gap-2 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              {t(language, "pacs.resetBtn") || "Reset"}
            </button>
          </div>

          {error && (
            <p className="text-sm font-mono-data" style={{ color: "var(--accent)" }}>{error}</p>
          )}
        </form>
      </div>

      {/* Results */}
      <div className="card-shell card-elevated overflow-hidden">
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full" style={{ background: "var(--accent)" }} />
            <h3 className="text-sm font-semibold text-embossed" style={{ color: "var(--text)" }}>
              {t(language, "pacs.studies", { count: searchResults.length })}
            </h3>
          </div>
          {selectedNode && (
            <span className="text-xs font-mono-data pill-soft px-2 py-0.5 rounded-full" style={{ color: "var(--text-muted)" }}>
              Node: {selectedNode.name}
            </span>
          )}
        </div>
        {isSearching ? (
          <div className="p-8 text-center">
            <div className="spinner-industrial mx-auto mb-3" />
            <p className="font-mono-data" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.searchingPacs")}</p>
          </div>
        ) : searchResults.length === 0 ? (
          <div className="p-8 text-center font-mono-data" style={{ color: "var(--text-muted)" }}>{t(language, "pacs.noStudies")}</div>
        ) : (
          <ul className="divide-y max-h-[600px] overflow-y-auto" >
            {searchResults.map((study, index) => (
              <li key={index} className="p-4 transition-colors" style={{ background: "transparent" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--foreground)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium font-mono-data" style={{ color: "var(--text)" }}>
                      {study.patientName || study.patientId || t(language, "pacs.studyLabel", { num: index + 1 })}
                    </p>
                    <p className="text-sm font-mono-data mt-1" style={{ color: "var(--text-muted)" }}>
                      {t(language, "pacs.fieldDate")}: {study.studyDate || "—"} • {t(language, "pacs.fieldModality")}: {study.modality || "—"}
                    </p>
                    <p className="text-xs font-mono-data mt-0.5" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                      {t(language, "pacs.fieldDescription")}: {study.description || "—"}
                    </p>
                    {study.accessionNumber && (
                      <p className="text-xs font-mono-data mt-0.5" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
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
