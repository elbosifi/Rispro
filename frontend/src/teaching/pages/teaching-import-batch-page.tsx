import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, ErrorState, LoadingState } from "@/components/shared";
import { useTeachingAuth } from "../auth/teaching-auth-context";
import { TeachingAccessDenied } from "../components/teaching-access-denied";
import { fetchTeachingImportBatch } from "../api/teaching-api";

function value(record: Record<string, unknown>, key: string): string {
  const item = record[key];
  if (item === null || item === undefined || item === "") return "—";
  return String(item);
}

export function TeachingImportBatchPage() {
  const navigate = useNavigate();
  const { batchId = "" } = useParams();
  const { identity } = useTeachingAuth();
  const canInspect = Boolean(identity?.permissions.some((permission) => ["teaching.author", "teaching.review", "teaching.publish", "teaching.admin"].includes(permission)));
  const batch = useQuery({ queryKey: ["teaching", "import-batch", batchId], queryFn: () => fetchTeachingImportBatch(batchId), enabled: canInspect && Boolean(batchId) });
  if (!canInspect) return <TeachingAccessDenied capability="Teaching editorial access" />;
  if (batch.isPending) return <LoadingState message="Loading Teaching import batch…" />;
  if (batch.isError) return <ErrorState title="Could not load import batch" message={batch.error.message} onRetry={() => void batch.refetch()} />;
  const data = batch.data;
  if (!data) return <ErrorState title="Import batch not found" message="The Teaching import batch is unavailable." />;
  const uploader = typeof data.uploader === "object" && data.uploader !== null && "identitySubject" in data.uploader ? String((data.uploader as { identitySubject: unknown }).identitySubject) : "—";
  const counts = ["questionCount", "caseCount", "assetCount"] as const;
  return (
    <section aria-labelledby="teaching-import-batch-title" className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching administration · Import lineage</p><h1 id="teaching-import-batch-title" className="mt-1 text-2xl font-semibold text-foreground">Import batch</h1><p className="mt-2 break-all font-mono text-sm text-muted-foreground">{batchId}</p></div>
        <Badge variant="info">{value(data, "status")}</Badge>
      </div>
      <Card className="p-4 sm:p-6">
        <h2 className="font-semibold text-foreground">Read-only audit details</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Original filename</dt><dd>{value(data, "originalFilename")}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Schema version</dt><dd>{value(data, "schemaVersion")}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Imported by</dt><dd>{uploader}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Import date</dt><dd>{data.createdAt ? new Date(String(data.createdAt)).toLocaleString() : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Confirmed date</dt><dd>{data.confirmedAt ? new Date(String(data.confirmedAt)).toLocaleString() : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Confirmed by</dt><dd>{typeof data.confirmedBy === "object" && data.confirmedBy !== null && "identitySubject" in data.confirmedBy ? String((data.confirmedBy as { identitySubject: unknown }).identitySubject) : "—"}</dd></div>
        </dl>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">{counts.map((key) => <div key={key} className="rounded-lg bg-muted/50 p-3"><p className="text-xs capitalize text-muted-foreground">{key.replace("Count", "s")}</p><p className="mt-1 text-xl font-semibold text-foreground">{value(data, key)}</p></div>)}</div>
        {data.failureMessage ? <p role="alert" className="mt-4 text-sm text-destructive">{String(data.failureMessage)}</p> : null}
      </Card>
      <div className="flex flex-wrap gap-3"><Button onClick={() => navigate("/teaching/admin/questions")}>Back to questions</Button></div>
    </section>
  );
}
