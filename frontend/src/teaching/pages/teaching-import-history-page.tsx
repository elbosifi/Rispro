import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, LoadingState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shared";
import { fetchTeachingImportBatches } from "../api/teaching-api";

const PAGE_SIZE = 20;

function publicationLabel(publication: {
  total: number; draft: number; inReview: number; published: number; retired: number;
} | null): string {
  if (!publication) return "Not confirmed";
  if (publication.total === 0) return "No questions";
  return [
    publication.draft ? `${publication.draft} Draft` : null,
    publication.inReview ? `${publication.inReview} In Review` : null,
    publication.published ? `${publication.published} Published` : null,
    publication.retired ? `${publication.retired} Retired` : null,
  ].filter(Boolean).join(" · ");
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function TeachingImportHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const history = useQuery({
    queryKey: ["teaching", "import-batches", PAGE_SIZE, offset],
    queryFn: () => fetchTeachingImportBatches(PAGE_SIZE, offset),
    staleTime: 10_000,
  });

  if (history.isLoading) return <LoadingState message="Loading Teaching import history" />;
  if (history.isError || !history.data) {
    return <ErrorState message="Teaching import history could not be loaded." onRetry={() => void history.refetch()} />;
  }
  const totalPages = Math.max(1, Math.ceil(history.data.pagination.total / PAGE_SIZE));

  return (
    <section aria-labelledby="teaching-import-history-title" className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching administration</p>
          <h1 id="teaching-import-history-title" className="mt-1 text-2xl font-semibold text-foreground">Import history</h1>
          <p className="mt-1 text-sm text-muted-foreground">Recent imports, their validation state, and current question publication status.</p>
        </div>
        <Link className="btn-secondary inline-flex h-[var(--control-height-md)] items-center px-4" to="/teaching/admin/import">Import questions</Link>
      </header>

      {history.data.items.length === 0 ? (
        <Card><EmptyState message="No Teaching imports yet. Confirm an import to see its batch here." /></Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[960px]">
              <TableHeader><TableRow>
                <TableHead>Original filename</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead>Imported by</TableHead>
                <TableHead>Schema</TableHead>
                <TableHead>Questions</TableHead>
                <TableHead>Batch status</TableHead>
                <TableHead>Publication</TableHead>
                <TableHead>Action</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {history.data.items.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="max-w-64 break-all font-medium">{batch.originalFilename}</TableCell>
                    <TableCell className="whitespace-nowrap">{dateLabel(batch.createdAt)}</TableCell>
                    <TableCell className="max-w-48 break-all">{batch.uploader.identitySubject}</TableCell>
                    <TableCell>{batch.schemaVersion ?? "—"}</TableCell>
                    <TableCell>{batch.questionCount}</TableCell>
                    <TableCell className="capitalize">{batch.status.replaceAll("_", " ")}</TableCell>
                    <TableCell className="max-w-72 text-sm">{publicationLabel(batch.publication)}</TableCell>
                    <TableCell><Link className="text-accent underline-offset-4 hover:underline" to={`/teaching/admin/import/batches/${encodeURIComponent(batch.id)}`}>Open batch</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Page {page} of {totalPages} · {history.data.pagination.total} imports</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSearchParams(page > 2 ? { page: String(page - 1) } : {})} disabled={page <= 1}>Previous</Button>
          <Button variant="outline" onClick={() => setSearchParams({ page: String(page + 1) })} disabled={page >= totalPages}>Next</Button>
        </div>
      </div>
    </section>
  );
}
