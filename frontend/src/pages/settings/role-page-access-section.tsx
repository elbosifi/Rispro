import { useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPageVisibilityMatrix, savePageVisibilityMatrix } from "@/lib/api-hooks";
import {
  DEFAULT_PAGE_VISIBILITY_MATRIX,
  PAGE_VISIBILITY_ROLES,
  PAGE_VISIBILITY_ROUTE_KEYS,
  normalizePageVisibilityMatrix,
  type PageVisibilityMatrix,
  type PageVisibilityRouteKey,
} from "@/lib/page-visibility";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";
import { isReAuthRequiredError } from "./settings-page.helpers";

const ROLE_LABELS: Record<string, string> = {
  receptionist: "Receptionist",
  supervisor: "Supervisor",
  modality_staff: "Technologist",
  doctor: "Doctor",
  administrative: "Administrative",
  super_admin: "Super Admin",
};

const PAGE_LABELS: Record<PageVisibilityRouteKey, string> = {
  dashboard: "Dashboard",
  patients: "Patients",
  "patients.merge": "Patient Merge",
  "name.dictionary": "Name Dictionary",
  appointments: "Appointments",
  "scheduling.override.requests": "Override Requests",
  "v2.appointments.admin": "Scheduling Policy Admin",
  calendar: "Calendar",
  registrations: "Registrations",
  "request.scans": "Request Scans",
  queue: "Queue",
  "queue.checkin": "Queue Check-In",
  modality: "Modality",
  comparisons: "Comparisons",
  doctor: "Doctor",
  print: "Print",
  statistics: "Statistics",
  pacs: "PACS",
  "pacs.remap": "PACS remap",
  "worklist.monitor": "MWL Monitor",
  legacy: "Legacy",
  settings: "Settings",
};

export default function RolePageAccessSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  type PageVisibilityDraftOverride = {
    baseUpdatedAt: number;
    value: PageVisibilityMatrix;
  };

  const queryClient = useQueryClient();
  const [draftOverride, setDraftOverride] = useState<PageVisibilityDraftOverride | null>(null);
  const [message, setMessage] = useState<string>("");

  const { data, dataUpdatedAt, isLoading, error } = useQuery({
    queryKey: ["settings", "users_and_roles", "page_visibility_by_role"],
    queryFn: fetchPageVisibilityMatrix,
    staleTime: 1000 * 60,
    retry: false,
  });

  const serverDraft = normalizePageVisibilityMatrix(data ?? DEFAULT_PAGE_VISIBILITY_MATRIX);
  const draft =
    draftOverride?.baseUpdatedAt === dataUpdatedAt
      ? draftOverride.value
      : serverDraft;
  const setDraft: Dispatch<SetStateAction<PageVisibilityMatrix>> = (nextDraft) => {
    setDraftOverride((currentOverride) => {
      const currentDraft =
        currentOverride?.baseUpdatedAt === dataUpdatedAt
          ? currentOverride.value
          : serverDraft;

      return {
        baseUpdatedAt: dataUpdatedAt,
        value: typeof nextDraft === "function" ? nextDraft(currentDraft) : nextDraft,
      };
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.settings.includes("super_admin")) {
        throw new Error("Settings access must always include Super Admin.");
      }
      return savePageVisibilityMatrix(draft);
    },
    onSuccess: async (saved) => {
      setDraftOverride({
        baseUpdatedAt: dataUpdatedAt,
        value: normalizePageVisibilityMatrix(saved),
      });
      setMessage("Role page visibility saved.");
      await queryClient.invalidateQueries({ queryKey: ["settings", "users_and_roles", "page_visibility_by_role"] });
    },
    onError: (err: unknown) => {
      if (isReAuthRequiredError(err)) {
        onReAuthRequired(["settings", "users_and_roles", "page_visibility_by_role"]);
        return;
      }
      setMessage(err instanceof Error ? err.message : "Failed to save role page visibility.");
    },
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "users_and_roles", "page_visibility_by_role"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) return <p className="description-center">Loading role page access...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm description-center">
        Configure which roles can see which pages in navigation. This affects sidebar/mobile visibility only.
      </p>
      <div className="overflow-auto border border-stone-200 dark:border-stone-700 rounded-lg">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-stone-100 dark:bg-stone-800">
              <th className="text-start p-2 font-semibold">Page</th>
              {PAGE_VISIBILITY_ROLES.map((role) => (
                <th key={role} className="text-center p-2 font-semibold">{ROLE_LABELS[role]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAGE_VISIBILITY_ROUTE_KEYS.map((routeKey) => (
              <tr key={routeKey} className="border-t border-stone-200 dark:border-stone-700">
                <td className="p-2">{PAGE_LABELS[routeKey]}</td>
                {PAGE_VISIBILITY_ROLES.map((role) => {
                  const checked = draft[routeKey]?.includes(role) ?? false;
                  const isSettingsSuperAdmin = routeKey === "settings" && role === "super_admin";
                  return (
                    <td key={`${routeKey}-${role}`} className="text-center p-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isSettingsSuperAdmin}
                        onChange={(event) => {
                          setDraft((prev) => {
                            const currentRoles = prev[routeKey] || [];
                            const nextRoles = event.target.checked
                              ? [...currentRoles, role]
                              : currentRoles.filter((r) => r !== role);
                            const next = {
                              ...prev,
                              [routeKey]: Array.from(new Set(nextRoles)),
                            } as PageVisibilityMatrix;
                            if (!next.settings.includes("super_admin")) {
                              next.settings = Array.from(new Set([...next.settings, "super_admin"]));
                            }
                            return next;
                          });
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary text-sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save"}
        </button>
        <button
          className="btn-secondary text-sm"
          onClick={() => setDraft(serverDraft)}
          disabled={saveMutation.isPending}
        >
          Reset
        </button>
      </div>
      {message ? <div className="p-3 rounded border border-stone-200 dark:border-stone-700 text-sm">{message}</div> : null}
    </div>
  );
}
