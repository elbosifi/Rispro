import { useEffect, useMemo, useState } from "react";
import type { PolicySnapshotDto } from "../types";

export function PolicyDraftEditor({
  snapshot,
  onSave,
  isSaving,
}: {
  snapshot: PolicySnapshotDto | null;
  onSave: (nextSnapshot: PolicySnapshotDto, changeNote: string | null) => Promise<void>;
  isSaving: boolean;
}) {
  const initialJson = useMemo(
    () => (snapshot ? JSON.stringify(snapshot, null, 2) : ""),
    [snapshot]
  );
  const [jsonValue, setJsonValue] = useState(initialJson);
  const [changeNote, setChangeNote] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setJsonValue(initialJson);
    setParseError(null);
  }, [initialJson]);

  async function handleSave() {
    try {
      const parsed = JSON.parse(jsonValue) as PolicySnapshotDto;
      setParseError(null);
      await onSave(parsed, changeNote.trim() || null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Invalid JSON");
    }
  }

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid var(--border-color, #e2e8f0)",
        backgroundColor: "var(--bg-surface, #f8fafc)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Draft Editor</h2>
      <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginBottom: 8 }}>
        Edit the V2 `PolicySnapshotDto` JSON directly and save to update draft hash/snapshot.
      </p>
      <textarea
        value={jsonValue}
        onChange={(e) => setJsonValue(e.target.value)}
        rows={16}
        style={{
          width: "100%",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          border: "1px solid var(--border-color, #e2e8f0)",
          borderRadius: 6,
          padding: 10,
          marginBottom: 8,
          background: "#fff",
        }}
      />
      <input
        type="text"
        placeholder="Change note (optional)"
        value={changeNote}
        onChange={(e) => setChangeNote(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 10px",
          border: "1px solid var(--border-color, #e2e8f0)",
          borderRadius: 6,
          marginBottom: 8,
        }}
      />
      {parseError && (
        <div style={{ color: "var(--color-error, #ef4444)", fontSize: 12, marginBottom: 8 }}>
          Invalid snapshot JSON: {parseError}
        </div>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        style={{
          padding: "8px 14px",
          borderRadius: 6,
          border: "none",
          backgroundColor: "var(--color-primary, #3b82f6)",
          color: "#fff",
          cursor: isSaving ? "not-allowed" : "pointer",
          opacity: isSaving ? 0.6 : 1,
        }}
      >
        {isSaving ? "Saving..." : "Save Draft Snapshot"}
      </button>
    </div>
  );
}

