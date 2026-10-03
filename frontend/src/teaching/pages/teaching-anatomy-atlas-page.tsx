import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers3 } from "lucide-react";
import { Badge, Card, ErrorState, LoadingState, SearchInput } from "@/components/shared";
import { fetchTeachingAnatomyManifest, type TeachingAnatomyManifest, type TeachingAnatomyStructure } from "../api/teaching-api";
import { Anatomy3dViewer } from "../anatomy/anatomy-3d-viewer";
import { anatomySelectionReducer, initialAnatomySelectionState } from "../anatomy/anatomy-selection";
import { CrossSectionStackViewer } from "../anatomy/cross-section-stack-viewer";
import { getAnatomyPlaneSpec, type AnatomyPlane } from "../anatomy/anatomy-nrrd";
import { loadTeachingAnatomyVolumes, type LoadedAnatomyVolumes } from "../anatomy/anatomy-volume-loader";

interface VolumeState {
  manifest: TeachingAnatomyManifest;
  attempt: number;
  data: LoadedAnatomyVolumes | null;
  error: string | null;
}

function displayTitle(atlasId: string, title: string): string {
  return atlasId === "spl-liver" ? "Liver anatomy" : title;
}

function structureMatches(structure: TeachingAnatomyStructure, query: string): boolean {
  if (!query) return true;
  return [structure.name, structure.id, structure.category, structure.organ, structure.bodyRegion, structure.system, ...structure.synonyms]
    .filter(Boolean)
    .some((value) => value!.toLocaleLowerCase().includes(query));
}

function matchingTreeIds(structures: TeachingAnatomyStructure[], query: string): Set<string> {
  if (!query) return new Set(structures.map(({ id }) => id));
  const byId = new Map(structures.map((structure) => [structure.id, structure]));
  const result = new Set<string>();
  for (const structure of structures) {
    if (!structureMatches(structure, query)) continue;
    let current: TeachingAnatomyStructure | undefined = structure;
    while (current && !result.has(current.id)) {
      result.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return result;
}

function groupedRoots(manifest: TeachingAnatomyManifest): Array<[string, TeachingAnatomyStructure[]]> {
  const parents = new Set(manifest.structures.map(({ id }) => id));
  const groups = new Map<string, TeachingAnatomyStructure[]>();
  for (const structure of manifest.structures) {
    if (structure.parentId && parents.has(structure.parentId)) continue;
    const group = groups.get(structure.category) ?? [];
    group.push(structure);
    groups.set(structure.category, group);
  }
  return [...groups.entries()];
}

export function TeachingAnatomyAtlasPage({ atlasId }: { atlasId: string }) {
  return <TeachingAnatomyAtlasPageContent key={atlasId} atlasId={atlasId} />;
}

function TeachingAnatomyAtlasPageContent({ atlasId }: { atlasId: string }) {
  const manifestQuery = useQuery({ queryKey: ["teaching", "anatomy", "manifest", atlasId], queryFn: () => fetchTeachingAnatomyManifest(atlasId), staleTime: 30_000 });
  const [selection, dispatch] = useReducer(anatomySelectionReducer, initialAnatomySelectionState);
  const [volumeLoadAttempt, setVolumeLoadAttempt] = useState(0);
  const [volumeState, setVolumeState] = useState<VolumeState | null>(null);
  const [plane, setPlane] = useState<AnatomyPlane>("axial");
  const [sliceIndex, setSliceIndex] = useState(0);
  const [structureSearch, setStructureSearch] = useState("");
  const [expandedStructureIds, setExpandedStructureIds] = useState<string[]>([]);
  const [hiddenStructureIds, setHiddenStructureIds] = useState<string[]>([]);
  const [isolatedStructureId, setIsolatedStructureId] = useState<string | null>(null);
  const manifest = manifestQuery.data?.available ? manifestQuery.data.manifest : null;
  const selectedStructure = manifest?.structures.find((structure) => structure.id === selection.selectedStructureId) ?? null;
  const visibleTreeIds = useMemo(() => manifest ? matchingTreeIds(manifest.structures, structureSearch.trim().toLocaleLowerCase()) : new Set<string>(), [manifest, structureSearch]);
  const selectStructure = useCallback((structureId: string) => dispatch({ type: "select-structure", structureId }), []);

  useEffect(() => {
    if (!manifest) return;
    const controller = new AbortController();
    const attempt = volumeLoadAttempt;
    void loadTeachingAnatomyVolumes(manifest, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setVolumeState({ manifest, attempt, data, error: null });
      if (data.primary) {
        const initialPlane = manifest.initialSlice?.plane ?? manifest.supportedPlanes[0] ?? "axial";
        const spec = getAnatomyPlaneSpec(data.primary.geometry, initialPlane);
        setPlane(initialPlane);
        setSliceIndex(manifest.initialSlice?.index !== undefined && manifest.initialSlice.index < spec.sliceCount
          ? manifest.initialSlice.index
          : Math.floor(spec.sliceCount / 2));
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setVolumeState({ manifest, attempt, data: null, error: error instanceof Error ? error.message : "Atlas data could not be loaded." });
    });
    return () => controller.abort();
  }, [manifest, volumeLoadAttempt]);

  if (manifestQuery.isLoading) return <LoadingState message="Loading anatomy atlas" />;
  if (manifestQuery.isError || !manifestQuery.data) return <ErrorState message="The Teaching anatomy atlas could not be loaded." onRetry={() => void manifestQuery.refetch()} />;
  if (!manifestQuery.data.available) {
    return (
      <section className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <AnatomyBreadcrumbs title={displayTitle(atlasId, manifestQuery.data.title)} />
        <header><h1 className="text-2xl font-semibold text-foreground">{displayTitle(atlasId, manifestQuery.data.title)}</h1><p className="mt-1 text-sm text-muted-foreground">Anatomy reference atlas</p></header>
        <Card className="space-y-2 border border-amber-200 bg-amber-50 p-5" role="status">
            <h2 className="font-semibold text-foreground">{manifestQuery.data.status === "pending-source-validation" ? "Pending source validation" : "Dataset not installed"}</h2>
          <p className="text-sm text-muted-foreground">{manifestQuery.data.message}</p>
          <p className="text-sm text-muted-foreground">Source terms and attribution are listed in <Link to="/teaching/anatomy/sources" className="font-medium text-primary underline-offset-4 hover:underline">Sources &amp; licenses</Link>.</p>
        </Card>
      </section>
    );
  }

  const activeManifest = manifestQuery.data.manifest;
  const currentVolumeState = volumeState?.manifest === activeManifest && volumeState.attempt === volumeLoadAttempt ? volumeState : null;
  if (!currentVolumeState) return <LoadingState message={`Reading ${activeManifest.modality} and spatial metadata`} />;
  if (currentVolumeState.error || !currentVolumeState.data) return <ErrorState message={`${activeManifest.title} could not be validated: ${currentVolumeState.error ?? "atlas data unavailable"}`} onRetry={() => setVolumeLoadAttempt((attempt) => attempt + 1)} />;

  const { primary, segmentation } = currentVolumeState.data;
  const activePlane: AnatomyPlane = activeManifest.supportedPlanes.includes(plane) ? plane : activeManifest.supportedPlanes[0] ?? "axial";
  const planeSpec = primary ? getAnatomyPlaneSpec(primary.geometry, activePlane) : null;
  const canOverlaySelected = Boolean(segmentation && selectedStructure?.labelValue !== undefined);
  const canOpenLiverAtlas = activeManifest.atlasId === "bodyparts3d" && selectedStructure !== null
    && [selectedStructure.name, selectedStructure.organ, ...selectedStructure.synonyms].some((value) => value?.toLocaleLowerCase().includes("liver"));
  const roots = groupedRoots(activeManifest);
  const childrenByParent = new Map<string, TeachingAnatomyStructure[]>();
  for (const structure of activeManifest.structures) {
    if (!structure.parentId) continue;
    const children = childrenByParent.get(structure.parentId) ?? [];
    children.push(structure);
    childrenByParent.set(structure.parentId, children);
  }
  const renderStructure = (structure: TeachingAnatomyStructure, depth = 0): React.ReactNode => {
    if (!visibleTreeIds.has(structure.id)) return null;
    const children = childrenByParent.get(structure.id) ?? [];
    const searchActive = structureSearch.trim().length > 0;
    const expanded = searchActive || expandedStructureIds.includes(structure.id);
    const hidden = hiddenStructureIds.includes(structure.id);
    const isolated = isolatedStructureId === structure.id;
    return (
      <li key={structure.id}>
        <div className="flex items-center gap-1" style={{ paddingInlineStart: depth ? `${Math.min(depth, 5) * 0.75}rem` : undefined }}>
          {children.length > 0 && !searchActive && <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${structure.name}`} aria-expanded={expanded} onClick={() => setExpandedStructureIds((current) => expanded ? current.filter((id) => id !== structure.id) : [...current, structure.id])} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>}
          <button type="button" aria-pressed={selection.selectedStructureId === structure.id} onClick={() => selectStructure(structure.id)} title={structure.note || structure.name} className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-start text-xs transition-colors ${selection.selectedStructureId === structure.id ? "bg-muted font-semibold text-accent" : "text-foreground hover:bg-muted"}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/15" style={{ backgroundColor: structure.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{structure.name}</span>
          </button>
          {structure.meshAsset && <button type="button" aria-label={`${hidden ? "Show" : "Hide"} ${structure.name}`} aria-pressed={!hidden} onClick={() => setHiddenStructureIds((current) => hidden ? current.filter((id) => id !== structure.id) : [...current, structure.id])} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
          {structure.meshAsset && <button type="button" aria-label={`${isolated ? "Restore all structures" : `Isolate ${structure.name}`}`} aria-pressed={isolated} onClick={() => setIsolatedStructureId((current) => current === structure.id ? null : structure.id)} className={`rounded px-1.5 py-1 text-[0.65rem] ${isolated ? "bg-muted text-accent" : "text-muted-foreground hover:bg-muted"}`}>{isolated ? "Restore" : "Isolate"}</button>}
        </div>
        {children.length > 0 && expanded && <ul className="mt-0.5 space-y-0.5">{children.map((child) => renderStructure(child, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <section aria-labelledby="anatomy-atlas-title" className="space-y-4 px-4 py-4 sm:px-6 lg:px-8">
      <AnatomyBreadcrumbs title={displayTitle(atlasId, activeManifest.title)} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="anatomy-atlas-title" className="text-2xl font-semibold text-foreground">{displayTitle(atlasId, activeManifest.title)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{activeManifest.bodyRegion} · {activeManifest.modality} · {activeManifest.structures.length} structures · {activeManifest.coordinateSystem} physical coordinates</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">{activeManifest.modality}</Badge>
          {segmentation && <div className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs text-muted-foreground" style={{ borderColor: "var(--border)" }}>
            <Layers3 size={15} aria-hidden="true" /> Overlay
            <button type="button" aria-pressed={selection.overlayMode === "off"} onClick={() => dispatch({ type: "set-overlay-mode", overlayMode: "off" })} className={`rounded px-2 py-1 ${selection.overlayMode === "off" ? "bg-muted font-semibold text-accent" : "hover:bg-muted"}`}>Off</button>
            <button type="button" aria-pressed={selection.overlayMode === "selected"} disabled={!canOverlaySelected} onClick={() => dispatch({ type: "set-overlay-mode", overlayMode: "selected" })} className={`rounded px-2 py-1 disabled:opacity-50 ${selection.overlayMode === "selected" ? "bg-muted font-semibold text-accent" : "hover:bg-muted"}`}>Selected structure</button>
          </div>}
          {hiddenStructureIds.length > 0 && <button type="button" onClick={() => setHiddenStructureIds([])} className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">Show all</button>}
        </div>
      </header>

      <div className={`grid items-stretch gap-3 ${primary ? "xl:grid-cols-[15rem_minmax(18rem,1fr)_minmax(20rem,1.1fr)]" : "xl:grid-cols-[18rem_minmax(0,1fr)]"}`}>
        <aside aria-label="Anatomical structures" className="max-h-[38rem] min-w-0 overflow-auto rounded-xl border bg-card p-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="px-2 pb-2 text-sm font-semibold text-foreground">Structures</h2>
          <SearchInput aria-label="Search structures and synonyms" className="mb-3" value={structureSearch} onChange={(event) => setStructureSearch(event.target.value)} placeholder="Search structures" showClearButton onClear={() => setStructureSearch("")} />
          <p className="mb-2 px-2 text-xs text-muted-foreground">Search names or synonyms, or expand a row to browse its children.</p>
          <nav>
            {roots.map(([category, structures]) => (
              <div key={category} className="mb-3 last:mb-0">
                <h3 className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">{category}</h3>
                <ul className="space-y-0.5">{structures.map((structure) => renderStructure(structure))}</ul>
              </div>
            ))}
            {visibleTreeIds.size === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No structures match this search.</p>}
          </nav>
        </aside>

        <Anatomy3dViewer manifest={activeManifest} geometry={primary?.geometry ?? null} plane={activePlane} sliceIndex={sliceIndex} selectedStructureId={selection.selectedStructureId} hiddenStructureIds={hiddenStructureIds} isolatedStructureId={isolatedStructureId} onSelectStructure={selectStructure} />
        {primary && planeSpec && activeManifest.volumes.primary ? <CrossSectionStackViewer primary={primary} segmentation={segmentation} modality={activeManifest.volumes.primary.modality} display={activeManifest.volumes.primary} plane={activePlane} supportedPlanes={activeManifest.supportedPlanes} planeSpec={planeSpec} sliceIndex={sliceIndex} onPlaneChange={(nextPlane) => { setPlane(nextPlane); setSliceIndex(Math.floor(getAnatomyPlaneSpec(primary.geometry, nextPlane).sliceCount / 2)); }} onSliceChange={setSliceIndex} selectedLabel={selectedStructure?.labelValue ?? null} selectedColor={selectedStructure?.color ?? null} overlayEnabled={selection.overlayMode === "selected" && canOverlaySelected} />
          : <Card className="flex min-h-[30rem] items-center justify-center p-6 text-center" role="status"><p className="max-w-sm text-sm text-muted-foreground">Cross-sectional reference atlas not yet available.</p></Card>}
      </div>

      <Card className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3">
        <div className="min-w-48"><p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">Selected structure</p><p className="mt-1 text-sm font-semibold text-foreground">{selectedStructure?.name ?? "Choose a structure in the list or 3D model"}</p></div>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{selectedStructure?.note || "Select a structure to view its anatomical label and educational note."}</p>
        {canOpenLiverAtlas && <Link to="/teaching/anatomy/liver" className="self-center rounded-md border px-3 py-2 text-sm font-medium text-primary hover:bg-muted">Open dedicated Liver atlas</Link>}
      </Card>
      <p className="text-[0.68rem] text-muted-foreground">Educational reference atlas · {activeManifest.provenance.project} · <Link to="/teaching/anatomy/sources" className="font-medium underline-offset-4 hover:underline">Source and license details</Link></p>
    </section>
  );
}

function AnatomyBreadcrumbs({ title }: { title: string }) {
  return <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground"><Link to="/teaching/anatomy" className="hover:text-accent">Anatomy</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>;
}
