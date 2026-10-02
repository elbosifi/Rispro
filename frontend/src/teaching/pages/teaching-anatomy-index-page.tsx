import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Scan } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Card, ErrorState, LoadingState } from "@/components/shared";
import { fetchTeachingAnatomyManifest } from "../api/teaching-api";

export function TeachingAnatomyIndexPage() {
  const atlas = useQuery({ queryKey: ["teaching", "anatomy", "liver-manifest"], queryFn: fetchTeachingAnatomyManifest, staleTime: 30_000 });

  return (
    <section aria-labelledby="teaching-anatomy-title" className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching</p>
        <h1 id="teaching-anatomy-title" className="mt-1 text-2xl font-semibold text-foreground">Anatomy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Interactive 3D reference atlases for radiology education.</p>
      </header>
      {atlas.isLoading ? <LoadingState message="Checking available anatomy atlases" /> : null}
      {atlas.isError ? <ErrorState message="Anatomy atlas availability could not be checked." onRetry={() => void atlas.refetch()} /> : null}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-accent" aria-hidden="true"><Scan size={23} /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">SPL Liver Atlas</h2>
                {!atlas.isLoading && !atlas.isError && (
                  <Badge variant={atlas.data?.available ? "success" : "warning"}>
                    {atlas.data?.available ? "Ready" : "Dataset not installed"}
                  </Badge>
                )}
              </div>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">CT with aligned segmentation, liver structures, and a synchronized axial slice plane.</p>
            </div>
          </div>
          <Link to="/teaching/anatomy/liver" className="btn-primary inline-flex h-[var(--control-height-md)] shrink-0 items-center gap-2 px-4">
            Open liver atlas <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </section>
  );
}
