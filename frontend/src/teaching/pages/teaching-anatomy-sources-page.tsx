import { Link } from "react-router-dom";
import { Card, ErrorState, LoadingState } from "@/components/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchTeachingAnatomyCatalog } from "../api/teaching-api";

function safeCitationHref(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function TeachingAnatomySourcesPage() {
  const catalog = useQuery({ queryKey: ["teaching", "anatomy", "catalog"], queryFn: fetchTeachingAnatomyCatalog });
  if (catalog.isLoading) return <LoadingState message="Loading atlas source and license records" />;
  if (catalog.isError || !catalog.data) return <ErrorState message="Atlas source records could not be loaded." onRetry={() => void catalog.refetch()} />;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/teaching/anatomy" className="hover:text-accent">Anatomy</Link><span aria-hidden="true">/</span><span aria-current="page">Sources &amp; licenses</span>
      </nav>
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Sources &amp; licenses</h1>
        <p className="mt-2 text-sm text-muted-foreground">Attribution and license details are kept with each atlas. Follow the linked terms and citation before reusing or redistributing atlas data.</p>
      </header>
      <section aria-label="Atlas source records" className="space-y-3">
        {catalog.data.items.map((item) => {
          const citationHref = safeCitationHref(item.provenance.citation);
          return (
          <Card key={item.atlasId} className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-foreground"><Link to={`/teaching/anatomy/atlas/${encodeURIComponent(item.atlasId)}`} className="underline-offset-4 hover:underline">{item.title}</Link></h2>
              <span className="text-xs text-muted-foreground">{item.status.replaceAll("-", " ")}</span>
            </div>
            <p className="text-sm"><span className="font-medium">Attribution:</span> {item.provenance.attribution}</p>
            <p className="text-sm"><span className="font-medium">Project:</span> {item.provenance.project}</p>
            <p className="text-sm"><span className="font-medium">License:</span> {item.provenance.license}</p>
            {item.provenance.use && <p className="text-sm"><span className="font-medium">Use and limitations:</span> {item.provenance.use}</p>}
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <a href={item.provenance.sourceRepository} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">Upstream source</a>
              <a href={item.provenance.licenseUrl} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">License terms</a>
              {citationHref && <a href={citationHref} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">Citation</a>}
            </div>
            {item.provenance.citation && !citationHref && <p className="text-sm"><span className="font-medium">Citation:</span> {item.provenance.citation}</p>}
          </Card>
          );
        })}
      </section>
    </main>
  );
}
