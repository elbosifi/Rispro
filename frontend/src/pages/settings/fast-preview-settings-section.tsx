import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@/components/shared";
import { api, ApiError } from "@/lib/api-client";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";

type Values = { quality: number; width: number };
type Row = { setting_key: string; setting_value: { value?: string } };

export default function FastPreviewSettingsSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Values | null>(null);
  const query = useQuery({ queryKey: ["settings", "fast_preview"], queryFn: () => api<{ settings: Row[] }>("/settings/fast_preview") });
  const rows = query.data?.settings ?? [];
  const quality = Number(rows.find((row) => row.setting_key === "jpeg_quality")?.setting_value?.value ?? 75);
  const width = Number(rows.find((row) => row.setting_key === "maximum_image_width")?.setting_value?.value ?? 512);
  const values = draft ?? { quality, width };
  const save = useMutation({
    mutationFn: () => api("/settings/fast_preview", { method: "PUT", body: JSON.stringify({ entries: [{ key: "jpeg_quality", value: values.quality }, { key: "maximum_image_width", value: values.width }] }) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["settings", "fast_preview"] }); setDraft(null); },
  });
  const error = query.error ?? save.error;
  if (error instanceof ApiError && error.status === 403) return <ReAuthPrompt onReAuthRequired={() => { save.reset(); onReAuthRequired(["settings", "fast_preview"]); }} />;
  if (query.isLoading) return <p>Loading settings…</p>;
  if (query.error) return <QueryError message={query.error.message} />;
  return <div dir="ltr" className="space-y-4 max-w-lg text-left">
    <p className="text-sm text-muted-foreground">Controls compressed images in Fast Preview. Higher JPEG quality generally produces larger files.</p>
    <label className="grid gap-1 text-sm">JPEG Compression Quality<Input type="number" min={30} max={95} step={1} value={values.quality} onChange={(event) => setDraft({ ...values, quality: Number(event.target.value) })} /></label>
    <label className="grid gap-1 text-sm">Maximum Image Width<select className="input-premium" value={values.width} onChange={(event) => setDraft({ ...values, width: Number(event.target.value) })}>{[256, 384, 512, 768, 1024].map((value) => <option key={value} value={value}>{value} pixels</option>)}</select></label>
    <p className="text-xs text-muted-foreground">Images preserve their aspect ratio and are never enlarged beyond their original width.</p>
    {save.isError && <p role="alert" className="text-sm text-red-700">{save.error.message}</p>}
    {save.isSuccess && <p role="status" className="text-sm">Fast Preview settings saved.</p>}
    <Button onClick={() => save.mutate()} disabled={save.isPending || !Number.isInteger(values.quality) || values.quality < 30 || values.quality > 95}>Save</Button>
  </div>;
}
