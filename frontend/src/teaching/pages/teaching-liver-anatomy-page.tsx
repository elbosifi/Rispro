import { useCallback, useEffect, useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers3 } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, ErrorState, LoadingState } from "@/components/shared";
import { fetchTeachingAnatomyManifest, type TeachingAnatomyManifest } from "../api/teaching-api";
import { Anatomy3dViewer } from "../anatomy/anatomy-3d-viewer";
import { anatomySelectionReducer, initialAnatomySelectionState } from "../anatomy/anatomy-selection";
import { CtStackViewer } from "../anatomy/ct-stack-viewer";
import { loadTeachingAnatomyVolumes, type LoadedAnatomyVolumes } from "../anatomy/anatomy-volume-loader";

interface VolumeState {
  manifest: TeachingAnatomyManifest;
  attempt: number;
  data: LoadedAnatomyVolumes | null;
  error: string | null;
}

function groupedStructures(manifest: TeachingAnatomyManifest) {
  const groups = new Map<string, TeachingAnatomyManifest["structures"]>();
  for (const structure of manifest.structures) {
    const group = groups.get(structure.category) ?? [];
    group.push(structure);
    groups.set(structure.category, group);
  }
  return [...groups.entries()];
}

export function TeachingLiverAnatomyPage() {
  const manifestQuery = useQuery({ queryKey: ["teaching", "anatomy", "liver-manifest"], queryFn: fetchTeachingAnatomyManifest, staleTime: 30_000 });
  const [selection, dispatch] = useReducer(anatomySelectionReducer, initialAnatomySelectionState);
  const [sliceIndex, setSliceIndex] = useState(0);
  const [volumeLoadAttempt, setVolumeLoadAttempt] = useState(0);
  const [volumeState, setVolumeState] = useState<VolumeState | null>(null);
  const manifest = manifestQuery.data?.available ? manifestQuery.data.manifest : null;
  const selectedStructure = manifest?.structures.find((structure) => structure.id === selection.selectedStructureId) ?? null;
  const selectStructure = useCallback((structureId: string) => dispatch({ type: "select-structure", structureId }), []);

  useEffect(() => {
    if (!manifest) return;
    const controller = new AbortController();
    const attempt = volumeLoadAttempt;
    void loadTeachingAnatomyVolumes(manifest, controller.signal).then((data) => {
      if (!controller.signal.aborted) {
        setVolumeState({ manifest, attempt, data, error: null });
        setSliceIndex(Math.floor(data.ct.geometry.sizes[2] / 2));
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setVolumeState({ manifest, attempt, data: null, error: error instanceof Error ? error.message : "Atlas volumes could not be loaded." });
    });
    return () => controller.abort();
  }, [manifest, volumeLoadAttempt]);

  if (manifestQuery.isLoading) return <LoadingState message="Loading the SPL Liver Atlas" />;
  if (manifestQuery.isError || !manifestQuery.data) return <ErrorState message="The Teaching anatomy catalog could not be loaded." onRetry={() => void manifestQuery.refetch()} />;
  if (!manifestQuery.data.available) {
    return (
      <section aria-labelledby="liver-anatomy-title" className="space-y-5">
        <AnatomyBreadcrumbs />
        <header><h1 id="liver-anatomy-title" className="text-2xl font-semibold text-foreground">Liver anatomy</h1><p className="mt-1 text-sm text-muted-foreground">SPL Liver Atlas reference workspace</p></header>
        <Card className="border border-amber-200 bg-amber-50 p-5" role="status">
          <h2 className="font-semibold text-foreground">Dataset not installed</h2>
          <p className="mt-1 text-sm text-muted-foreground">{manifestQuery.data.message}</p>
          <p className="mt-3 text-sm text-muted-foreground">Install from a local SPLLiverAtlas checkout with its Git LFS objects fetched. See <code>docs/teaching-anatomy.md</code> for the command.</p>
        </Card>
      </section>
    );
  }
  const currentVolumeState = volumeState?.manifest === manifest && volumeState.attempt === volumeLoadAttempt ? volumeState : null;
  if (!currentVolumeState) return <LoadingState message="Reading CT, segmentation, and spatial metadata" />;
  if (currentVolumeState.error || !currentVolumeState.data) return <ErrorState message={`The SPL Liver Atlas could not be validated: ${currentVolumeState.error ?? "volume data unavailable"}`} onRetry={() => setVolumeLoadAttempt((attempt) => attempt + 1)} />;

  const { ct, segmentation } = currentVolumeState.data;
  const groups = groupedStructures(manifestQuery.data.manifest);
  return (
    <section aria-labelledby="liver-anatomy-title" className="space-y-4">
      <AnatomyBreadcrumbs />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 id="liver-anatomy-title" className="text-2xl font-semibold text-foreground">Liver anatomy</h1><p className="mt-1 text-sm text-muted-foreground">SPL Liver Atlas · CT and label map in {ct.geometry.coordinateSystem} physical coordinates</p></div>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground" style={{ borderColor: "var(--border)" }}>
          <Layers3 size={15} aria-hidden="true" /> Overlay
          <button type="button" aria-pressed={selection.overlayMode === "off"} onClick={() => dispatch({ type: "set-overlay-mode", overlayMode: "off" })} className={`rounded px-2 py-1 ${selection.overlayMode === "off" ? "bg-muted font-semibold text-accent" : "hover:bg-muted"}`}>Off</button>
          <button type="button" aria-pressed={selection.overlayMode === "selected"} onClick={() => dispatch({ type: "set-overlay-mode", overlayMode: "selected" })} className={`rounded px-2 py-1 ${selection.overlayMode === "selected" ? "bg-muted font-semibold text-accent" : "hover:bg-muted"}`}>Selected structure</button>
        </div>
      </header>

      <div className="grid items-stretch gap-3 xl:grid-cols-[13rem_minmax(20rem,1.15fr)_minmax(19rem,.95fr)]">
        <aside aria-label="Anatomical structures" className="max-h-[35rem] min-w-0 overflow-auto rounded-xl border bg-card p-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="px-2 pb-2 text-sm font-semibold text-foreground">Structures</h2>
          <nav className="space-y-3">
            {groups.map(([category, structures]) => (
              <div key={category}>
                <h3 className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
                <ul className="space-y-0.5">
                  {structures.map((structure) => (
                    <li key={structure.id}>
                      <button type="button" aria-pressed={selection.selectedStructureId === structure.id} onClick={() => dispatch({ type: "select-structure", structureId: structure.id })} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-xs transition-colors ${selection.selectedStructureId === structure.id ? "bg-muted font-semibold text-accent" : "text-foreground hover:bg-muted"}`}>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: structure.color }} aria-hidden="true" />
                        <span className="min-w-0 flex-1">{structure.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <Anatomy3dViewer manifest={manifestQuery.data.manifest} geometry={ct.geometry} sliceIndex={sliceIndex} selectedStructureId={selection.selectedStructureId} onSelectStructure={selectStructure} />
        <CtStackViewer ct={ct} segmentation={segmentation} sliceIndex={sliceIndex} onSliceChange={setSliceIndex} selectedLabel={selectedStructure?.labelValue ?? null} selectedColor={selectedStructure?.color ?? null} overlayEnabled={selection.overlayMode === "selected" && selectedStructure !== null} />
      </div>

      <Card className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3">
        <div className="min-w-48"><p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">Selected structure</p><p className="mt-1 text-sm font-semibold text-foreground">{selectedStructure?.name ?? "Choose a structure in the list or 3D model"}</p></div>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{selectedStructure?.note ?? "The CT slice plane and segmentation overlay use the atlas spatial transform. Select a structure to view its short radiology note."}</p>
      </Card>
      <p className="text-[0.68rem] text-muted-foreground">Educational reference atlas · {manifestQuery.data.manifest.provenance.project}</p>
    </section>
  );
}

function AnatomyBreadcrumbs() {
  return <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground"><Link to="/teaching/anatomy" className="hover:text-accent">Anatomy</Link><span aria-hidden="true">/</span><span aria-current="page">Liver</span></nav>;
}
