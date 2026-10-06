import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers3 } from "lucide-react";
import { Badge, Card, ErrorState, LoadingState, SearchInput } from "@/components/shared";
import { fetchTeachingAnatomyCatalog, fetchTeachingAnatomyManifest, type TeachingAnatomyManifest, type TeachingAnatomyStructure } from "../api/teaching-api";
import { Anatomy3dViewer } from "../anatomy/anatomy-3d-viewer";
import { canRenderAnatomyStructure } from "../anatomy/anatomy-structure-mesh-selection";
import { anatomySelectionReducer, initialAnatomySelectionState } from "../anatomy/anatomy-selection";
import { CrossSectionStackViewer } from "../anatomy/cross-section-stack-viewer";
import { anatomyVolumeCenterLps, type AnatomyPlane } from "../anatomy/anatomy-nrrd";
import { loadTeachingAnatomyVolumes, type LoadedAnatomyVolumes } from "../anatomy/anatomy-volume-loader";

interface VolumeState {
  manifest: TeachingAnatomyManifest;
  attempt: number;
  data: LoadedAnatomyVolumes | null;
  error: string | null;
}

function structureMatches(structure: TeachingAnatomyStructure, query: string): boolean {
  if (!query) return true;
  return [structure.name, structure.id, structure.category, structure.organ, structure.bodyRegion, structure.system, ...structure.synonyms]
    .filter(Boolean)
    .some((value) => value!.toLocaleLowerCase().includes(query));
}

function matchingTreeIds(structures: TeachingAnatomyStructure[], query: string, bodyRegion: string, system: string): Set<string> {
  if (!query && !bodyRegion && !system) return new Set(structures.map(({ id }) => id));
  const byId = new Map(structures.map((structure) => [structure.id, structure]));
  const result = new Set<string>();
  for (const structure of structures) {
    if (!structureMatches(structure, query) || (bodyRegion && structure.bodyRegion !== bodyRegion) || (system && structure.system !== system)) continue;
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
  const workspaceRef = useRef<HTMLElement>(null);
  const manifestQuery = useQuery({ queryKey: ["teaching", "anatomy", "manifest", atlasId], queryFn: () => fetchTeachingAnatomyManifest(atlasId), staleTime: 30_000 });
  const catalogQuery = useQuery({ queryKey: ["teaching", "anatomy", "catalog"], queryFn: fetchTeachingAnatomyCatalog, staleTime: 30_000 });
  const [selection, dispatch] = useReducer(anatomySelectionReducer, initialAnatomySelectionState);
  const [volumeLoadAttempt, setVolumeLoadAttempt] = useState(0);
  const [volumeState, setVolumeState] = useState<VolumeState | null>(null);
  const [worldPointLps, setWorldPointLps] = useState<[number, number, number] | null>(null);
  const [structureSearch, setStructureSearch] = useState("");
  const [expandedStructureIds, setExpandedStructureIds] = useState<string[]>([]);
  const [hiddenStructureIds, setHiddenStructureIds] = useState<string[]>([]);
  const [isolatedStructureId, setIsolatedStructureId] = useState<string | null>(null);
  const [sectionPlanesVisible, setSectionPlanesVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState<"axial" | "sagittal" | "coronal" | "3d">("axial");
  const [bodyRegionFilter, setBodyRegionFilter] = useState("");
  const [systemFilter, setSystemFilter] = useState("");
  const manifest = manifestQuery.data?.available ? manifestQuery.data.manifest : null;
  const selectedStructure = manifest?.structures.find((structure) => structure.id === selection.selectedStructureId) ?? null;
  const visibleTreeIds = useMemo(() => manifest ? matchingTreeIds(manifest.structures, structureSearch.trim().toLocaleLowerCase(), bodyRegionFilter, systemFilter) : new Set<string>(), [manifest, structureSearch, bodyRegionFilter, systemFilter]);
  const selectStructure = useCallback((structureId: string) => {
    dispatch({ type: "select-structure", structureId });
    const structure = manifest?.structures.find((entry) => entry.id === structureId);
    if (structure?.representativePointLps) setWorldPointLps(structure.representativePointLps);
  }, [manifest]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === workspaceRef.current) await document.exitFullscreen();
    else await workspaceRef.current?.requestFullscreen();
  };

  useEffect(() => {
    if (!manifest) return;
    const controller = new AbortController();
    const attempt = volumeLoadAttempt;
    void loadTeachingAnatomyVolumes(manifest, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setVolumeState({ manifest, attempt, data, error: null });
      if (data.primary) {
        setWorldPointLps(anatomyVolumeCenterLps(data.primary.geometry));
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
        <AnatomyBreadcrumbs title={manifestQuery.data.title} />
        <header><h1 className="text-2xl font-semibold text-foreground">{manifestQuery.data.title}</h1><p className="mt-1 text-sm text-muted-foreground">Anatomy reference atlas</p></header>
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
  const activeWorldPoint = primary ? (worldPointLps ?? anatomyVolumeCenterLps(primary.geometry)) : null;
  const canOverlaySelected = Boolean(segmentation && selectedStructure?.labelValue !== undefined);
  const relatedAtlasIds = selectedStructure?.relatedAtlasIds ?? [];
  const bodyRegionOptions = [...new Set(activeManifest.structures.map(({ bodyRegion }) => bodyRegion).filter((value): value is string => Boolean(value)))].sort();
  const systemOptions = [...new Set(activeManifest.structures.map(({ system }) => system).filter((value): value is string => Boolean(value)))].sort();
  const filteredOutMeshIds = activeManifest.structures.filter((structure) => structure.meshAsset
    && ((bodyRegionFilter && structure.bodyRegion !== bodyRegionFilter) || (systemFilter && structure.system !== systemFilter))).map(({ id }) => id);
  const effectiveHiddenStructureIds = [...new Set([...hiddenStructureIds, ...filteredOutMeshIds])];
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
    const has3dGeometry = canRenderAnatomyStructure(activeManifest, structure.id);
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
          {has3dGeometry && <button type="button" aria-label={`${hidden ? "Show" : "Hide"} ${structure.name}`} aria-pressed={!hidden} onClick={() => setHiddenStructureIds((current) => hidden ? current.filter((id) => id !== structure.id) : [...current, structure.id])} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
          {has3dGeometry && <button type="button" aria-label={`${isolated ? "Restore all structures" : `Isolate ${structure.name}`}`} aria-pressed={isolated} onClick={() => setIsolatedStructureId((current) => current === structure.id ? null : structure.id)} className={`rounded px-1.5 py-1 text-[0.65rem] ${isolated ? "bg-muted text-accent" : "text-muted-foreground hover:bg-muted"}`}>{isolated ? "Restore" : "Isolate"}</button>}
        </div>
        {children.length > 0 && expanded && <ul className="mt-0.5 space-y-0.5">{children.map((child) => renderStructure(child, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <section ref={workspaceRef} aria-labelledby="anatomy-atlas-title" className={`min-w-0 max-w-full space-y-4 overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8 ${fullscreen ? "h-screen overflow-y-auto bg-background" : ""}`}>
      <AnatomyBreadcrumbs title={activeManifest.title} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="anatomy-atlas-title" className="text-2xl font-semibold text-foreground">{activeManifest.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{activeManifest.bodyRegion} · {activeManifest.modality} · {activeManifest.structures.length} structures · {activeManifest.coordinateSystem} physical coordinates</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">{activeManifest.modality}</Badge>
          {segmentation && <div className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs text-muted-foreground" style={{ borderColor: "var(--border)" }}>
            <Layers3 size={15} aria-hidden="true" /> Overlay
            <button type="button" aria-pressed={selection.overlayMode === "off"} onClick={() => dispatch({ type: "set-overlay-mode", overlayMode: "off" })} className={`rounded px-2 py-1 ${selection.overlayMode === "off" ? "bg-muted font-semibold text-accent" : "hover:bg-muted"}`}>Off</button>
            <button type="button" aria-pressed={selection.overlayMode === "selected"} disabled={!canOverlaySelected} onClick={() => dispatch({ type: "set-overlay-mode", overlayMode: "selected" })} className={`rounded px-2 py-1 disabled:opacity-50 ${selection.overlayMode === "selected" ? "bg-muted font-semibold text-accent" : "hover:bg-muted"}`}>Selected structure</button>
          </div>}
          {primary && <button type="button" aria-pressed={sectionPlanesVisible} onClick={() => setSectionPlanesVisible((visible) => !visible)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">{sectionPlanesVisible ? "Hide section planes" : "Show section planes"}</button>}
          {hiddenStructureIds.length > 0 && <button type="button" onClick={() => setHiddenStructureIds([])} className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">Show all</button>}
          {primary && <button type="button" onClick={() => void toggleFullscreen()} className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted" aria-label={fullscreen ? "Exit full screen radiology workspace" : "Enter full screen radiology workspace"}>{fullscreen ? "Exit fullscreen" : "Fullscreen workspace"}</button>}
        </div>
      </header>

      <div className={`grid items-stretch gap-3 ${primary ? "xl:grid-cols-[15rem_minmax(0,1fr)]" : "xl:grid-cols-[18rem_minmax(0,1fr)]"}`}>
        <aside aria-label="Anatomical structures" className="max-h-[38rem] min-w-0 overflow-auto rounded-xl border bg-card p-3" style={{ borderColor: "var(--border)" }}>
          <h2 className="px-2 pb-2 text-sm font-semibold text-foreground">Structures</h2>
          <SearchInput aria-label="Search structures and synonyms" className="mb-3" value={structureSearch} onChange={(event) => setStructureSearch(event.target.value)} placeholder="Search structures" showClearButton onClear={() => setStructureSearch("")} />
          {bodyRegionOptions.length > 1 && <label className="mb-2 block px-2 text-xs text-muted-foreground">Body region<select aria-label="Filter structures by body region" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-foreground" value={bodyRegionFilter} onChange={(event) => setBodyRegionFilter(event.target.value)}><option value="">All regions</option>{bodyRegionOptions.map((value) => <option key={value}>{value}</option>)}</select></label>}
          {systemOptions.length > 1 && <label className="mb-2 block px-2 text-xs text-muted-foreground">System<select aria-label="Filter structures by system" className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-foreground" value={systemFilter} onChange={(event) => setSystemFilter(event.target.value)}><option value="">All systems</option>{systemOptions.map((value) => <option key={value}>{value}</option>)}</select></label>}
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

        <div className="min-w-0">
          {primary && activeWorldPoint && activeManifest.volumes.primary ? <>
            <div role="tablist" aria-label="Radiology viewport" className="mb-3 flex gap-1 overflow-x-auto lg:hidden">
              {(["axial", "sagittal", "coronal", "3d"] as const).map((viewport) => <button key={viewport} type="button" role="tab" aria-selected={mobileViewport === viewport} onClick={() => setMobileViewport(viewport)} className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${mobileViewport === viewport ? "bg-muted font-semibold text-accent" : "text-muted-foreground"}`}>{viewport === "3d" ? "3D" : viewport[0]!.toUpperCase() + viewport.slice(1)}</button>)}
            </div>
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              {(["axial", "sagittal", "coronal"] as AnatomyPlane[]).map((viewPlane) => <div key={viewPlane} className={`${mobileViewport === viewPlane ? "block" : "hidden"} min-w-0 lg:block`}><CrossSectionStackViewer primary={primary} segmentation={segmentation} modality={activeManifest.volumes.primary!.modality} display={activeManifest.volumes.primary} plane={viewPlane} worldPointLps={activeWorldPoint} onWorldPointLpsChange={setWorldPointLps} selectedLabel={selectedStructure?.labelValue ?? null} selectedColor={selectedStructure?.color ?? null} overlayEnabled={selection.overlayMode === "selected" && canOverlaySelected} /></div>)}
              <div className={`${mobileViewport === "3d" ? "block" : "hidden"} min-w-0 lg:block`}><Anatomy3dViewer manifest={activeManifest} geometry={primary.geometry} worldPointLps={activeWorldPoint} sectionPlanesVisible={sectionPlanesVisible} selectedStructureId={selection.selectedStructureId} hiddenStructureIds={effectiveHiddenStructureIds} isolatedStructureId={isolatedStructureId} onSelectStructure={selectStructure} /></div>
            </div>
          </> : <Anatomy3dViewer manifest={activeManifest} geometry={null} worldPointLps={null} sectionPlanesVisible={false} selectedStructureId={selection.selectedStructureId} hiddenStructureIds={effectiveHiddenStructureIds} isolatedStructureId={isolatedStructureId} onSelectStructure={selectStructure} />}
        </div>
      </div>

      <Card className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3">
        <div className="min-w-48"><p className="text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">Selected structure</p><p className="mt-1 text-sm font-semibold text-foreground">{selectedStructure?.name ?? "Choose a structure in the list or 3D model"}</p></div>
        {(selectedStructure?.radiologyNote || selectedStructure?.note) && <div className="min-w-0 flex-1 space-y-1 text-sm text-muted-foreground">{selectedStructure.radiologyNote && <p><span className="font-medium text-foreground">Radiology teaching note. </span>{selectedStructure.radiologyNote}</p>}{selectedStructure.note && <p><span className="font-medium text-foreground">Source anatomy metadata. </span>{selectedStructure.note}</p>}</div>}
        {relatedAtlasIds.map((relatedAtlasId) => {
          const relatedAtlas = catalogQuery.data?.items.find((item) => item.atlasId === relatedAtlasId);
          if (!relatedAtlas) return null;
          if (relatedAtlas.status === "ready") return <Link key={relatedAtlasId} to={`/teaching/anatomy/atlas/${relatedAtlasId}`} className="self-center rounded-md border px-3 py-2 text-sm font-medium text-primary hover:bg-muted">Open radiology atlas: {relatedAtlas.title}</Link>;
          const status = relatedAtlas.status === "pending-source-validation" ? "pending validation" : relatedAtlas.status === "unavailable" ? "unavailable" : "not installed";
          return <span key={relatedAtlasId} className="self-center rounded-md border px-3 py-2 text-xs text-muted-foreground" role="status">{relatedAtlas.title} - {status}</span>;
        })}
      </Card>
      <p className="text-[0.68rem] text-muted-foreground">Educational reference atlas · {activeManifest.provenance.project} · <Link to="/teaching/anatomy/sources" className="font-medium underline-offset-4 hover:underline">Source and license details</Link></p>
    </section>
  );
}

function AnatomyBreadcrumbs({ title }: { title: string }) {
  return <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground"><Link to="/teaching/anatomy" className="hover:text-accent">Anatomy</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>;
}
