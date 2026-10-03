import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, EmptyState, ErrorState, LoadingState, SearchInput } from "@/components/shared";
import { useQuery } from "@tanstack/react-query";
import { fetchTeachingAnatomyCatalog, type TeachingAnatomyAtlasCatalogEntry } from "../api/teaching-api";

type BrowseField = "bodyRegion" | "organs" | "systems";
const EMPTY_CATALOG_ITEMS: TeachingAnatomyAtlasCatalogEntry[] = [];

function browseValues(items: TeachingAnatomyAtlasCatalogEntry[], field: BrowseField): string[] {
  return [...new Set(items.flatMap((item) => field === "bodyRegion" ? [item.bodyRegion] : item[field]))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function matchesSearch(item: TeachingAnatomyAtlasCatalogEntry, query: string): boolean {
  if (!query) return true;
  const searchable = [item.title, item.bodyRegion, item.description, ...item.organs, ...item.systems,
    item.provenance.project, item.provenance.attribution, item.provenance.license, item.provenance.use]
    .join(" ")
    .toLocaleLowerCase();
  return searchable.includes(query.toLocaleLowerCase());
}

function statusLabel(status: TeachingAnatomyAtlasCatalogEntry["status"]): string {
  switch (status) {
    case "ready": return "Ready";
    case "not-installed": return "Not installed";
    case "unavailable": return "Unavailable";
    default: return "Pending source validation";
  }
}

function statusVariant(status: TeachingAnatomyAtlasCatalogEntry["status"]): "success" | "warning" | "error" | "neutral" {
  if (status === "ready") return "success";
  if (status === "unavailable") return "error";
  if (status === "pending-source-validation") return "warning";
  return "neutral";
}

export function TeachingAnatomyIndexPage() {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("");
  const [organ, setOrgan] = useState("");
  const [system, setSystem] = useState("");
  const catalog = useQuery({ queryKey: ["teaching", "anatomy", "catalog"], queryFn: fetchTeachingAnatomyCatalog });
  const items = catalog.data?.items ?? EMPTY_CATALOG_ITEMS;
  const filtered = useMemo(() => items.filter((item) =>
    (!region || item.bodyRegion === region)
    && (!organ || item.organs.includes(organ))
    && (!system || item.systems.includes(system))
    && matchesSearch(item, search.trim()),
  ), [items, organ, region, search, system]);

  if (catalog.isLoading) return <LoadingState message="Loading anatomy atlases" />;
  if (catalog.isError || !catalog.data) return <ErrorState message="The Teaching anatomy catalog could not be loaded." onRetry={() => void catalog.refetch()} />;

  const filters: Array<{ label: string; value: string; set: (value: string) => void; options: string[] }> = [
    { label: "Body region", value: region, set: setRegion, options: browseValues(items, "bodyRegion") },
    { label: "Organ", value: organ, set: setOrgan, options: browseValues(items, "organs") },
    { label: "System", value: system, set: setSystem, options: browseValues(items, "systems") },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Teaching</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Anatomy atlas library</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Browse licensed reference atlases by region, organ, or system. Atlas assets load only when you open an available atlas.</p>
        </div>
        <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" to="/teaching/anatomy/sources">Sources &amp; licenses</Link>
      </header>

      <Card className="space-y-4 p-4 sm:p-5">
        <SearchInput aria-label="Search anatomy atlases" placeholder="Search atlas, anatomy, or source" value={search} onChange={(event) => setSearch(event.target.value)} showClearButton onClear={() => setSearch("")} />
        <div className="grid gap-3 sm:grid-cols-3">
          {filters.map((filter) => (
            <label key={filter.label} className="text-sm font-medium text-foreground">
              {filter.label}
              <select className="input-premium mt-1 w-full" value={filter.value} onChange={(event) => filter.set(event.target.value)}>
                <option value="">All {filter.label.toLocaleLowerCase()}s</option>
                {filter.options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">Showing {filtered.length} of {items.length} atlases</p>
      </Card>

      {filtered.length === 0 ? <Card><EmptyState message="No atlases match these filters. Clear the search or choose another region, organ, or system." /></Card> : (
        <section aria-label="Anatomy atlases" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <Card key={item.atlasId} className="flex h-full flex-col gap-4 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{item.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{item.bodyRegion} · {item.modality}</p>
                </div>
                <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              <div className="space-y-2 text-sm">
                <p><span className="font-medium">Organs:</span> {item.organs.join(", ") || "Not specified"}</p>
                <p><span className="font-medium">Systems:</span> {item.systems.join(", ") || "Not specified"}</p>
                <p><span className="font-medium">Structures:</span> {item.structureCount ?? "Not validated"}</p>
              </div>
              <div className="mt-auto border-t border-border pt-3 text-xs text-muted-foreground">
                <p>{item.provenance.license}</p>
                <p className="mt-1 line-clamp-2">{item.provenance.attribution}</p>
                <div className="mt-3 flex flex-wrap gap-4">
                  <a href={item.provenance.licenseUrl} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">License terms</a>
                  {item.provenance.sourceRepository.startsWith("https://") && <a href={item.provenance.sourceRepository} target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">Source</a>}
                  <Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/teaching/anatomy/atlas/${encodeURIComponent(item.atlasId)}`} aria-label={`Open ${item.title}`}>Atlas details</Link>
                </div>
              </div>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
