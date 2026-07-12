import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Copy, ExternalLink, QrCode, RefreshCw } from "lucide-react";
import {
  fetchDoctorReportingWorklists,
  fetchMyDoctorReportingWorklist,
  updateDoctorReportingWorklist,
} from "@/lib/api-hooks";
import type { DoctorReportingWorklistSummary } from "@/types/api";

function worklistUrl(token: string): string {
  return `${window.location.origin}/reporting/worklist/${encodeURIComponent(token)}`;
}

function QrDialog({ dataUrl, onClose }: { dataUrl: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Doctor worklist QR code">
      <div className="rounded-xl border bg-white p-5 shadow-2xl">
        <img src={dataUrl} alt="Doctor worklist QR code" className="h-[220px] w-[220px]" />
        <button type="button" onClick={onClose} className="mt-4 h-10 w-full rounded-lg border text-sm font-semibold">Close</button>
      </div>
    </div>
  );
}

function WorklistActions({ worklist, management = false }: { worklist: DoctorReportingWorklistSummary; management?: boolean }) {
  const queryClient = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (payload: { active?: boolean; expiresAt?: string | null; rotate?: boolean }) => updateDoctorReportingWorklist(worklist.id, payload),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "doctor-worklists"] }),
  });
  const link = worklistUrl(worklist.token);
  return (
    <div className="flex flex-wrap gap-2">
      <a href={link} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"><ExternalLink size={14} />Open worklist</a>
      <button type="button" onClick={() => QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"><QrCode size={14} />Show QR</button>
      <button type="button" onClick={() => navigator.clipboard.writeText(link)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"><Copy size={14} />Copy link</button>
      {management && <>
        <button type="button" disabled={mutation.isPending} onClick={() => window.confirm("Rotate this doctor link? Existing QR codes will stop working.") && mutation.mutate({ rotate: true })} className="h-9 rounded-lg border px-3 text-xs font-semibold">Rotate link</button>
        <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate({ active: !worklist.active })} className="h-9 rounded-lg border px-3 text-xs font-semibold">{worklist.active ? "Disable link" : "Reactivate link"}</button>
        <button type="button" disabled={mutation.isPending} onClick={() => {
          const value = window.prompt("Expiry date/time (ISO), or leave empty to clear", worklist.expiresAt ?? "");
          if (value !== null) mutation.mutate({ expiresAt: value.trim() || null });
        }} className="h-9 rounded-lg border px-3 text-xs font-semibold">Set/clear expiry</button>
      </>}
      {qr && <QrDialog dataUrl={qr} onClose={() => setQr(null)} />}
    </div>
  );
}

export function MyReportingWorklistCard() {
  const query = useQuery({
    queryKey: ["doctor", "reporting-board", "doctor-worklists", "me"],
    queryFn: fetchMyDoctorReportingWorklist,
  });
  if (query.isLoading) return <section className="rounded-lg border p-4">Loading My Reporting Worklist…</section>;
  if (!query.data) return <section className="rounded-lg border p-4 text-sm text-red-700">My Reporting Worklist is unavailable.</section>;
  const worklist = query.data;
  return (
    <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>Permanent system scope</p>
          <h2 className="mt-1 text-lg font-semibold">My Reporting Worklist</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{worklist.effectiveModalityCodes.join(" / ") || "No effective reporting modalities"}</p>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs font-semibold">{worklist.active ? "Link active" : "Link unavailable"}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><p className="text-xs text-slate-500">Assigned pending</p><p className="text-2xl font-bold">{worklist.assignedPendingCount}</p></div>
        <div><p className="text-xs text-slate-500">Unassigned available</p><p className="text-2xl font-bold">{worklist.eligibleUnassignedCount}</p></div>
        <div><p className="text-xs text-slate-500">Last opened</p><p className="text-sm font-semibold">{worklist.lastAccessedAt ? new Date(worklist.lastAccessedAt).toLocaleString() : "Not opened"}</p></div>
        <div><p className="text-xs text-slate-500">Notifications</p><p className="text-sm font-semibold">{worklist.subscriptionCount} device{worklist.subscriptionCount === 1 ? "" : "s"}</p></div>
      </div>
      {worklist.scopeMessage && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{worklist.scopeMessage}</p>}
      <div className="mt-4"><WorklistActions worklist={worklist} /></div>
    </section>
  );
}

export function DoctorWorklistsPage() {
  const query = useQuery({
    queryKey: ["doctor", "reporting-board", "doctor-worklists"],
    queryFn: fetchDoctorReportingWorklists,
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Reporting administration</p><h2 className="text-2xl font-semibold">Doctor Worklists</h2></div>
        <button type="button" onClick={() => query.refetch()} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold"><RefreshCw size={14} />Refresh</button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-[1180px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Doctor</th><th className="p-3">Role/status</th><th className="p-3">Modalities</th><th className="p-3">Pending</th><th className="p-3">Link</th><th className="p-3">Notifications</th><th className="p-3">Actions</th></tr></thead>
          <tbody>{(query.data ?? []).map((worklist) => <tr key={worklist.id} className="border-t align-top">
            <td className="p-3 font-semibold">{worklist.doctorDisplayName}<span className="block text-xs font-normal text-slate-500">{worklist.username}</span></td>
            <td className="p-3">{worklist.doctorRole.replaceAll("_", " ")}<span className="block text-xs text-slate-500">User {worklist.userActive ? "active" : "inactive"} · Profile {worklist.doctorActive ? "active" : "inactive"}</span></td>
            <td className="p-3">{worklist.effectiveModalityCodes.join(" / ") || "None"}</td>
            <td className="p-3">{worklist.assignedPendingCount} assigned · {worklist.eligibleUnassignedCount} available</td>
            <td className="p-3">{worklist.active ? "Active" : "Unavailable"}<span className="block text-xs text-slate-500">{worklist.lastAccessedAt ? `Opened ${new Date(worklist.lastAccessedAt).toLocaleString()}` : "Not opened"}{worklist.expiresAt ? ` · Expires ${new Date(worklist.expiresAt).toLocaleString()}` : ""}</span></td>
            <td className="p-3">{worklist.subscriptionCount} enabled</td>
            <td className="p-3"><WorklistActions worklist={worklist} management /></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
