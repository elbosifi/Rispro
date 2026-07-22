import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Save } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { fetchPasskeyConfiguration, savePasskeyConfiguration, type PasskeyConfiguration } from "@/lib/api-hooks";

function detectedConfiguration(): PasskeyConfiguration | null {
  if (typeof window === "undefined") return null;
  try {
    const origin = new URL(window.location.origin);
    return { rpName: "RISpro", rpId: origin.hostname, origin: origin.origin };
  } catch {
    return null;
  }
}

export default function PasskeyConfigurationSection({ onReAuthRequired, reauthVersion }: { onReAuthRequired: (key: string[]) => void; reauthVersion: number }) {
  const queryClient = useQueryClient();
  const detected = useMemo(() => detectedConfiguration(), []);
  const [pendingSaveAfterReAuth, setPendingSaveAfterReAuth] = useState<number | null>(null);
  const { data: configured, isLoading, error } = useQuery({
    queryKey: ["passkey-configuration"],
    queryFn: fetchPasskeyConfiguration,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: () => {
      if (!detected) throw new Error("RISpro could not determine this browser address.");
      return savePasskeyConfiguration({ rpName: detected.rpName, origin: detected.origin });
    },
    onSuccess: async () => {
      setPendingSaveAfterReAuth(null);
      await queryClient.invalidateQueries({ queryKey: ["passkey-configuration"] });
    },
    onError: (error: unknown) => {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401 || status === 403) {
        setPendingSaveAfterReAuth(reauthVersion);
        onReAuthRequired(["passkey-configuration"]);
      }
    },
  });

  useEffect(() => {
    if (pendingSaveAfterReAuth != null && reauthVersion > pendingSaveAfterReAuth && !mutation.isPending) mutation.mutate();
  }, [pendingSaveAfterReAuth, reauthVersion, mutation]);

  const originIsSecure = Boolean(detected && (detected.origin.startsWith("https://") || detected.rpId === "localhost"));
  const saveError = mutation.error instanceof Error ? mutation.error.message : null;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <div className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" /> Passkey sign-in</div>
        <p className="mt-2 leading-6">RISpro detects the address open in this browser and saves it as the WebAuthn relying-party configuration. Open RISpro through its final HTTPS address before saving.</p>
      </div>

      <div className="rounded-xl border border-border bg-background p-4 text-sm">
        <p className="font-semibold text-foreground">Detected current address</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Origin</dt><dd className="break-all font-mono text-xs">{detected?.origin || "Unavailable"}</dd>
          <dt className="text-muted-foreground">RP ID</dt><dd className="font-mono text-xs">{detected?.rpId || "Unavailable"}</dd>
          <dt className="text-muted-foreground">Display name</dt><dd>RISpro</dd>
        </dl>
      </div>

      {!originIsSecure ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Passkeys require HTTPS. Open RISpro using its HTTPS hostname before saving this configuration.</p> : null}
      {isLoading ? <p className="text-sm text-muted-foreground">Loading passkey configuration…</p> : null}
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error instanceof Error ? error.message : "Could not load passkey configuration."}</p> : null}
      {configured ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Currently configured for <span className="font-mono">{configured.origin}</span>.</p> : null}

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={!originIsSecure || mutation.isPending}
        className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save current HTTPS address for passkeys
      </button>
      {saveError && !(mutation.error instanceof ApiError && (mutation.error.status === 401 || mutation.error.status === 403)) ? <p className="text-sm text-rose-700">{saveError}</p> : null}
    </div>
  );
}
