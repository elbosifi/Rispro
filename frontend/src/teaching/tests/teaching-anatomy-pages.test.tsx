import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeachingApplication } from "../teaching-application";
import type { TeachingAnatomyCatalog, TeachingAnatomyManifest, TeachingAnatomyManifestResult } from "../api/teaching-api";
import type { LoadedAnatomyVolumes } from "../anatomy/anatomy-volume-loader";

const anatomyMocks = vi.hoisted(() => ({ fetchManifest: vi.fn(), fetchCatalog: vi.fn(), loadVolumes: vi.fn() }));
const auth = vi.hoisted(() => ({
  isAuthenticated: true,
  isLoading: false,
  isIdentityLoading: false,
  mustChangePassword: false,
  identity: { identitySubject: "teaching-anatomy-test", displayName: "Anatomy Learner", permissions: ["teaching.access"] },
  login: vi.fn(), loginWithPasskey: vi.fn(), logout: vi.fn(), changePassword: vi.fn(),
}));

vi.mock("../auth/teaching-auth-provider", () => ({ TeachingAuthProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../auth/teaching-auth-context", () => ({ useTeachingAuth: () => auth }));
vi.mock("../api/teaching-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/teaching-api")>();
  return { ...actual, fetchTeachingAnatomyManifest: anatomyMocks.fetchManifest, fetchTeachingAnatomyCatalog: anatomyMocks.fetchCatalog };
});
vi.mock("../anatomy/anatomy-volume-loader", () => ({ loadTeachingAnatomyVolumes: anatomyMocks.loadVolumes }));
vi.mock("../anatomy/anatomy-3d-viewer", () => ({
  Anatomy3dViewer: ({ onSelectStructure, worldPointLps, sectionPlanesVisible, manifest }: { onSelectStructure: (structureId: string) => void; worldPointLps: [number, number, number] | null; sectionPlanesVisible: boolean; manifest: TeachingAnatomyManifest }) => {
    const structure = manifest.structures[0];
    return <section data-testid="mock-3d-viewer" data-world-point={worldPointLps?.join(",")} data-section-planes-visible={String(sectionPlanesVisible)}><h2>3D anatomy</h2>{structure && <button type="button" onClick={() => onSelectStructure(structure.id)}>{structure.id === "segment-viii" ? "Select Segment VIII in 3D" : `Select ${structure.name} in 3D`}</button>}</section>;
  },
}));
vi.mock("../anatomy/cross-section-stack-viewer", () => ({
  CrossSectionStackViewer: ({ worldPointLps, onWorldPointLpsChange, selectedLabel, overlayEnabled, plane, modality }: { worldPointLps: [number, number, number]; onWorldPointLpsChange: (point: [number, number, number]) => void; selectedLabel: number | null; overlayEnabled: boolean; plane: string; modality: string }) => (
    <section><h2>{`${plane[0]!.toLocaleUpperCase()}${plane.slice(1)} ${modality}`}</h2><div data-testid={`mock-cross-section-${plane}`} data-world-point={worldPointLps.join(",")} data-plane={plane} data-selected-label={selectedLabel ?? "none"} data-overlay-enabled={String(overlayEnabled)}>
      <button type="button" onClick={() => onWorldPointLpsChange([9, 8, 7])}>Move shared point</button>
    </div></section>
  ),
}));

const provenance = { sourceRepository: "https://example.org/source", project: "SPL Liver Atlas", attribution: "Upstream attribution.", license: "3D Slicer license.", licenseUrl: "https://example.org/license", use: "Educational material." };
const manifest: TeachingAnatomyManifest = {
  schemaVersion: "2.0",
  atlasId: "spl-liver",
  title: "SPL Liver Atlas",
  bodyRegion: "Abdomen",
  organs: ["Liver"],
  systems: ["Gastrointestinal"],
  modality: "CT",
  correlatedImaging: true,
  supportedPlanes: ["axial", "coronal", "sagittal"],
  coordinateSystem: "LPS",
  meshCoordinateSystem: "LPS",
  volumes: { primary: { assetKey: "primary", file: "primary.nrrd", modality: "CT", windowLevel: { width: 400, level: 40 } }, segmentation: { assetKey: "labels", file: "labels.nrrd" } },
  assets: {
    primary: { file: "primary.nrrd", mediaType: "application/octet-stream" },
    labels: { file: "labels.nrrd", mediaType: "application/octet-stream" },
    "mesh-segment-viii": { file: "segment-viii.stl", mediaType: "model/stl" },
  },
  structures: [{ id: "segment-viii", labelValue: 33, name: "Liver Segment VIII", category: "Liver segments", synonyms: ["anterior superior right hepatic segment"], color: "#53ad7a", meshAsset: "mesh-segment-viii", representativePointLps: [1, 0, 0], radiologyNote: "Anterosuperior right liver.", note: "Source description." }],
  provenance,
  spatialValidation: { status: "passed", method: "synthetic fixture", minimumMeshLabelAgreement: 0.2, meshLabelAgreement: { "segment-viii": 0.5 } },
};

const loadedVolumes: LoadedAnatomyVolumes = {
  primary: {
    geometry: { sizes: [2, 2, 3], coordinateSystem: "LPS", origin: [0, 0, 0], directions: [[1, 0, 0], [0, 1, 0], [0, 0, 2]] },
    data: new Int16Array(12).fill(100), type: "short", slope: 1, intercept: 0,
  },
  segmentation: {
    geometry: { sizes: [2, 2, 3], coordinateSystem: "LPS", origin: [0, 0, 0], directions: [[1, 0, 0], [0, 1, 0], [0, 0, 2]] },
    data: new Int16Array([0, 33, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), type: "short", slope: 1, intercept: 0,
  },
};

const wholeBodyManifest: TeachingAnatomyManifest = {
  ...manifest,
  atlasId: "bodyparts3d",
  title: "Whole-body 3D Navigator",
  bodyRegion: "Whole body",
  organs: ["Liver"],
  systems: ["Gastrointestinal"],
  modality: "3D",
  correlatedImaging: false,
  supportedPlanes: [],
  volumes: {},
  assets: { "whole-liver": { file: "liver.obj", mediaType: "model/obj" }, "whole-liver-lobe": { file: "liver-lobe.obj", mediaType: "model/obj" }, "whole-knee": { file: "knee.obj", mediaType: "model/obj" } },
  structures: [
    { id: "liver", name: "Liver", category: "Abdominal organs", synonyms: ["hepatic organ"], organ: "Liver", color: "#53ad7a", meshAsset: "whole-liver", relatedAtlasIds: ["spl-liver"], note: "Whole-body reference model." },
    { id: "liver-lobe", parentId: "liver", name: "Hepatic lobe", category: "Abdominal organs", synonyms: [], organ: "Liver", color: "#53ad7a", meshAsset: "whole-liver-lobe", note: "Component surface." },
    { id: "knee", name: "Knee", category: "Lower limb", synonyms: [], organ: "Knee", color: "#53ad7a", meshAsset: "whole-knee", relatedAtlasIds: ["spl-knee"], note: "Source reference model." },
  ],
  provenance: { ...provenance, project: "BodyParts3D", license: "CC BY 4.0", licenseUrl: "https://example.org/cc-by-4.0", citation: "Mitsuhashi N et al. BodyParts3D: 3D structure database for anatomical concepts. PMID:18835852." },
  spatialValidation: { status: "not-applicable", method: "Independent 3D reference; no regional image registration." },
};

const catalog: TeachingAnatomyCatalog = {
  items: [
    { atlasId: "spl-liver", title: "SPL Liver Atlas", bodyRegion: "Abdomen", organs: ["Liver", "Gallbladder"], systems: ["Gastrointestinal", "Vascular"], modality: "CT", crossSectionPlanes: ["axial"], description: "Liver segments and hepatic vessels.", correlatedImaging: true, status: "ready", structureCount: 17, provenance },
    { atlasId: "spl-knee", title: "SPL Knee Atlas", bodyRegion: "Lower limb", organs: ["Knee"], systems: ["Musculoskeletal"], modality: "MRI", crossSectionPlanes: [], description: "MRI knee reference.", correlatedImaging: true, status: "ready", structureCount: 42, provenance: { ...provenance, project: "SPL Knee Atlas" } },
    { atlasId: "bodyparts3d", title: "Whole-body 3D Navigator", bodyRegion: "Whole body", organs: ["Liver", "Knee"], systems: ["CNS", "Musculoskeletal"], modality: "3D", crossSectionPlanes: [], description: "Independent whole-body 3D reference.", correlatedImaging: false, status: "pending-source-validation", structureCount: null, provenance: { ...provenance, project: "BodyParts3D", citation: "Mitsuhashi N et al. BodyParts3D: 3D structure database for anatomical concepts. PMID:18835852." } },
  ],
};

function renderTeaching(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/teaching/*" element={<TeachingApplication />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Teaching anatomy routes and interaction", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  beforeEach(() => {
    auth.isAuthenticated = true;
    auth.identity = { identitySubject: "teaching-anatomy-test", displayName: "Anatomy Learner", permissions: ["teaching.access"] };
    anatomyMocks.fetchCatalog.mockResolvedValue(catalog);
    anatomyMocks.fetchManifest.mockResolvedValue({ available: false, atlasId: "spl-liver", title: "SPL Liver Atlas", status: "not-installed", message: "Dataset not installed." } satisfies TeachingAnatomyManifestResult);
    anatomyMocks.loadVolumes.mockResolvedValue(loadedVolumes);
  });

  it("browses the atlas catalog by region, organ, system, and search", async () => {
    renderTeaching("/teaching/anatomy");
    expect(await screen.findByRole("heading", { name: "Anatomy atlas library" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "SPL Liver Atlas" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /sources & licenses/i }).getAttribute("href")).toBe("/teaching/anatomy/sources");
    fireEvent.change(screen.getByLabelText("Body region"), { target: { value: "Lower limb" } });
    expect(screen.getByRole("heading", { name: "SPL Knee Atlas" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "SPL Liver Atlas" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Body region"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Organ"), { target: { value: "Liver" } });
    expect(screen.getByRole("heading", { name: "SPL Liver Atlas" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Whole-body 3D Navigator" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Organ"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("System"), { target: { value: "CNS" } });
    expect(screen.getByRole("heading", { name: "Whole-body 3D Navigator" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "SPL Knee Atlas" })).toBeNull();
    fireEvent.change(screen.getByLabelText("System"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search anatomy atlases" }), { target: { value: "SPL Knee" } });
    expect(screen.getByRole("heading", { name: "SPL Knee Atlas" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "SPL Liver Atlas" })).toBeNull();
  });

  it("makes every atlas card's primary title link navigable while keeping provenance links independent", async () => {
    const user = userEvent.setup();
    renderTeaching("/teaching/anatomy");
    const liver = await screen.findByRole("link", { name: "SPL Liver Atlas" });
    expect(liver.getAttribute("href")).toBe("/teaching/anatomy/atlas/spl-liver");
    expect(screen.getByRole("link", { name: "Whole-body 3D Navigator" }).getAttribute("href")).toBe("/teaching/anatomy/atlas/bodyparts3d");
    const license = screen.getAllByRole("link", { name: "License terms" })[0]!;
    const source = screen.getAllByRole("link", { name: "Source" })[0]!;
    expect(license.getAttribute("href")).toBe("https://example.org/license");
    expect(source.getAttribute("href")).toBe("https://example.org/source");
    expect(fireEvent.click(license)).toBe(true);
    expect(fireEvent.click(source)).toBe(true);
    expect(screen.getByRole("heading", { name: "Anatomy atlas library" })).toBeTruthy();
    liver.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Dataset not installed" })).toBeTruthy();
  });

  it("shows attribution and license details for every catalog entry", async () => {
    renderTeaching("/teaching/anatomy/sources");
    expect(await screen.findByRole("heading", { name: "Sources & licenses" })).toBeTruthy();
    expect(screen.getAllByText(/Upstream attribution/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "License terms" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Upstream source" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mitsuhashi N et al\. BodyParts3D/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Citation" })).toBeNull();
  });

  it("shows the compatible graceful not-installed state on the legacy liver route", async () => {
    renderTeaching("/teaching/anatomy/liver");
    expect(await screen.findByRole("heading", { name: "SPL Liver Atlas" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dataset not installed" })).toBeTruthy();
  });

  it("renders a V2 atlas, selects Segment VIII, and synchronizes the selected-label overlay across planes", async () => {
    anatomyMocks.fetchManifest.mockResolvedValue({ available: true, manifest } satisfies TeachingAnatomyManifestResult);
    renderTeaching("/teaching/anatomy/liver");
    expect(await screen.findByRole("heading", { name: "3D anatomy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Axial CT" })).toBeTruthy();
    await waitFor(() => expect(anatomyMocks.loadVolumes).toHaveBeenCalledWith(manifest, expect.any(AbortSignal)));
    const volumeViews = ["axial", "sagittal", "coronal"].map((plane) => screen.getByTestId(`mock-cross-section-${plane}`));
    expect(volumeViews[0].getAttribute("data-overlay-enabled")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Select Segment VIII in 3D" }));
    expect(screen.getByText("Anterosuperior right liver.")).toBeTruthy();
    for (const view of volumeViews) expect(view.getAttribute("data-world-point")).toBe("1,0,0");
    expect(screen.getByTestId("mock-3d-viewer").getAttribute("data-world-point")).toBe("1,0,0");
    expect(screen.getByRole("button", { name: "Hide section planes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Selected structure" }));
    for (const view of volumeViews) { expect(view.getAttribute("data-overlay-enabled")).toBe("true"); expect(view.getAttribute("data-selected-label")).toBe("33"); }
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Move shared point" })[0]!));
    for (const plane of ["axial", "sagittal", "coronal"]) expect(screen.getByTestId(`mock-cross-section-${plane}`).getAttribute("data-world-point")).toBe("9,8,7");
  });

  it("keeps a whole-body 3D reference usable without inventing a cross-sectional registration", async () => {
    anatomyMocks.fetchManifest.mockResolvedValue({ available: true, manifest: wholeBodyManifest } satisfies TeachingAnatomyManifestResult);
    anatomyMocks.loadVolumes.mockResolvedValue({ primary: null, segmentation: null } satisfies LoadedAnatomyVolumes);
    renderTeaching("/teaching/anatomy/atlas/bodyparts3d");
    expect(await screen.findByRole("heading", { name: "Whole-body 3D Navigator" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "3D anatomy" })).toBeTruthy();
    expect(screen.queryByText("Cross-sectional reference atlas not yet available.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hepatic lobe" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand Liver" }));
    expect(screen.getByRole("button", { name: "Hepatic lobe" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select Liver in 3D" }));
    expect(screen.getByRole("link", { name: "Open radiology atlas: SPL Liver Atlas" }).getAttribute("href")).toBe("/teaching/anatomy/atlas/spl-liver");
    fireEvent.change(screen.getByRole("textbox", { name: "Search structures and synonyms" }), { target: { value: "Knee" } });
    fireEvent.click(screen.getByRole("button", { name: "Knee" }));
    expect(screen.getByRole("link", { name: "Open radiology atlas: SPL Knee Atlas" }).getAttribute("href")).toBe("/teaching/anatomy/atlas/spl-knee");
  });
});
