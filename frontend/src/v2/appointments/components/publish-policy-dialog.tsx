import { useState } from "react";

export function PublishPolicyDialog({
  isOpen,
  onClose,
  onPublish,
  isPublishing,
}: {
  isOpen: boolean;
  onClose: () => void;
  onPublish: (changeNote: string | null) => Promise<void>;
  isPublishing: boolean;
}) {
  const [changeNote, setChangeNote] = useState("");

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(540px, calc(100vw - 24px))",
          background: "#fff",
          borderRadius: 8,
          padding: 16,
          border: "1px solid #e2e8f0",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
          Publish Draft Policy
        </h3>
        <p style={{ marginTop: 0, fontSize: 14, color: "#64748b" }}>
          This publishes the draft and makes it active for V2 scheduling.
        </p>
        <input
          type="text"
          placeholder="Publish note (optional)"
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            marginBottom: 12,
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPublishing}
            onClick={() => onPublish(changeNote.trim() || null)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              color: "#fff",
              backgroundColor: "#2563eb",
              opacity: isPublishing ? 0.65 : 1,
            }}
          >
            {isPublishing ? "Publishing..." : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}

