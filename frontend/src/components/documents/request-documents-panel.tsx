import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteAppointmentDocument,
  listAppointmentDocuments,
  prepareScanSession,
  uploadAppointmentDocument,
  type RequestDocument,
} from "@/lib/api-hooks";
import { pushToast } from "@/lib/toast";

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

interface RequestDocumentsPanelProps {
  appointmentId: number;
  patientId: number | null;
  title?: string;
  enablePreviewModal?: boolean;
}

export function RequestDocumentsPanel({
  appointmentId,
  patientId,
  title = "Request Documents",
  enablePreviewModal = false,
}: RequestDocumentsPanelProps) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("referral_request");
  const [selectedPreview, setSelectedPreview] = useState<RequestDocument | null>(null);

  const queryKey = useMemo(() => ["appointment-documents", appointmentId], [appointmentId]);
  const { data: documents = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: () => listAppointmentDocuments(appointmentId),
    enabled: Number.isFinite(appointmentId) && appointmentId > 0,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first.");
      const fileContentBase64 = await fileToBase64(file);
      return uploadAppointmentDocument({
        patientId,
        appointmentId,
        documentType: documentType || "referral_request",
        originalFilename: file.name,
        mimeType: file.type || "application/octet-stream",
        fileContentBase64,
      });
    },
    onSuccess: () => {
      setFile(null);
      queryClient.invalidateQueries({ queryKey });
      pushToast({
        type: "success",
        title: "Uploaded",
        message: "Request document uploaded successfully.",
      });
    },
    onError: (err: unknown) => {
      pushToast({
        type: "error",
        title: "Upload failed",
        message: err instanceof Error ? err.message : "Could not upload document.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: number) => deleteAppointmentDocument(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      pushToast({
        type: "success",
        title: "Deleted",
        message: "Request document deleted.",
      });
    },
    onError: (err: unknown) => {
      pushToast({
        type: "error",
        title: "Delete failed",
        message: err instanceof Error ? err.message : "Could not delete document.",
      });
    },
  });

  const prepareMutation = useMutation({
    mutationFn: async () =>
      prepareScanSession({
        appointmentId,
        patientId,
        documentType: documentType || "referral_request",
      }),
    onSuccess: (result) => {
      const preparation = (result as { preparation?: { sessionCode?: string; guidance?: string } }).preparation;
      pushToast({
        type: "success",
        title: "Scan prepared",
        message: `${preparation?.sessionCode || ""} ${preparation?.guidance || ""}`.trim(),
      });
    },
    onError: (err: unknown) => {
      pushToast({
        type: "error",
        title: "Prepare scan failed",
        message: err instanceof Error ? err.message : "Unable to prepare scan session.",
      });
    },
  });

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900 dark:text-white">{title}</h4>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          type="text"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          placeholder="Document type"
          className="input-premium"
        />
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="input-premium"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => prepareMutation.mutate()}
            className="px-3 py-2 rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 text-sm"
            disabled={prepareMutation.isPending}
          >
            {prepareMutation.isPending ? "Preparing..." : "Prepare Scan"}
          </button>
          <button
            type="button"
            onClick={() => uploadMutation.mutate()}
            className="px-3 py-2 rounded-lg bg-teal-600 text-white text-sm"
            disabled={!file || uploadMutation.isPending}
          >
            {uploadMutation.isPending ? "Uploading..." : "Attach Request"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-stone-500">Loading documents...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Failed to load documents."}</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-stone-500">No request documents yet.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-stone-200 dark:border-stone-700 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-stone-900 dark:text-white truncate">{doc.originalFilename}</div>
                  <div className="text-xs text-stone-500">
                    {doc.documentType} • {doc.mimeType || "file"} • {doc.storageLocationType}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {enablePreviewModal ? (
                    <button
                      type="button"
                      onClick={() => setSelectedPreview(doc)}
                      className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-700"
                    >
                      View
                    </button>
                  ) : (
                    <a
                      href={`/api/documents/${doc.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-700"
                    >
                      Open
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm("Delete this request document?")) return;
                      deleteMutation.mutate(doc.id);
                    }}
                    className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {enablePreviewModal && selectedPreview && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedPreview(null);
          }}
        >
          <div className="bg-white dark:bg-stone-900 rounded-xl w-full max-w-5xl h-[80vh] flex flex-col">
            <div className="p-3 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
              <div className="text-sm font-semibold">{selectedPreview.originalFilename}</div>
              <div className="flex gap-2">
                <a
                  href={`/api/documents/${selectedPreview.id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-700"
                >
                  Open in new tab
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedPreview(null)}
                  className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-700"
                >
                  Close
                </button>
              </div>
            </div>
            <iframe
              title={`doc-${selectedPreview.id}`}
              src={`/api/documents/${selectedPreview.id}/view`}
              className="w-full h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
