import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TeachingApplication } from "../teaching-application";
import type { TeachingAnatomyManifest, TeachingAnatomyManifestResult } from "../api/teaching-api";
import type { LoadedAnatomyVolumes } from "../anatomy/anatomy-volume-loader";

const anatomyMocks = vi.hoisted(() => ({ fetchManifest: vi.fn(), loadVolumes: vi.fn() }));
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
  return { ...actual, fetchTeachingAnatomyManifest: anatomyMocks.fetchManifest };
});
vi.mock("../anatomy/anatomy-volume-loader", () => ({ loadTeachingAnatomyVolumes: anatomyMocks.loadVolumes }));
vi.mock("../anatomy/anatomy-3d-viewer", () => ({
  Anatomy3dViewer: ({ onSelectStructure }: { onSelectStructure: (structureId: string) => void }) => <section><h2>3D anatomy</h2><button type="button" onClick={() => onSelectStructure("segment-viii")}>Select Segment VIII in 3D</button></section>,
}));
vi.mock("../anatomy/ct-stack-viewer", () => ({
  CtStackViewer: ({ sliceIndex, onSliceChange, selectedLabel, overlayEnabled }: { sliceIndex: number; onSliceChange: (index: number) => void; selectedLabel: number | null; overlayEnabled: boolean }) => (
    <section><h2>Axial CT</h2><div data-testid="mock-ct-viewer" data-slice={sliceIndex} data-selected-label={selectedLabel ?? "none"} data-overlay-enabled={String(overlayEnabled)}>
      <button type="button" onClick={() => onSliceChange(sliceIndex + 1)}>Next slice</button>
    </div></section>
  ),
}));

const manifest: TeachingAnatomyManifest = {
  schemaVersion: "1.0",
  atlasId: "spl-liver",
  title: "SPL Liver Atlas",
  modality: "CT",
  coordinateSystem: "LPS",
  meshCoordinateSystem: "LPS",
  volumes: { ct: { assetKey: "ct", file: "ct.nrrd" }, segmentation: { assetKey: "labels", file: "labels.nrrd" } },
  assets: {
    ct: { file: "ct.nrrd", mediaType: "application/octet-stream" },
    labels: { file: "labels.nrrd", mediaType: "application/octet-stream" },
    "mesh-segment-viii": { file: "segment-viii.stl", mediaType: "model/stl" },
  },
  structures: [{ id: "segment-viii", labelValue: 33, name: "Liver Segment VIII", category: "Liver segments", color: "#53ad7a", meshAsset: "mesh-segment-viii", note: "Anterosuperior right liver." }],
  provenance: { sourceRepository: "https://github.com/lorensen/SPLLiverAtlas", project: "SPL Liver Atlas", attribution: "Upstream attribution.", license: "3D Slicer license.", licenseUrl: "https://www.openanatomy.org/atlas-pages/slicer-license.html", use: "Educational material." },
  spatialValidation: { status: "passed", method: "synthetic fixture", minimumMeshLabelAgreement: 0.2, meshLabelAgreement: { "segment-viii": 0.5 } },
};

const loadedVolumes: LoadedAnatomyVolumes = {
  ct: {
    geometry: { sizes: [1, 1, 3], coordinateSystem: "LPS", origin: [0, 0, 0], directions: [[1, 0, 0], [0, 1, 0], [0, 0, 2]] },
    data: new Int16Array([0, 0, 0]), type: "short", slope: 1, intercept: 0,
  },
  segmentation: {
    geometry: { sizes: [1, 1, 3], coordinateSystem: "LPS", origin: [0, 0, 0], directions: [[1, 0, 0], [0, 1, 0], [0, 0, 2]] },
    data: new Int16Array([0, 33, 0]), type: "short", slope: 1, intercept: 0,
  },
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
    anatomyMocks.fetchManifest.mockResolvedValue({ available: false, atlasId: "spl-liver", title: "SPL Liver Atlas", message: "Dataset not installed." } satisfies TeachingAnatomyManifestResult);
    anatomyMocks.loadVolumes.mockResolvedValue(loadedVolumes);
  });

  it("renders Anatomy navigation and the reference atlas route for teaching.access users", async () => {
    renderTeaching("/teaching/anatomy");
    expect(await screen.findByRole("heading", { name: "Anatomy" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /open liver atlas/i }).getAttribute("href")).toBe("/teaching/anatomy/liver");
    expect(screen.getAllByRole("link", { name: /anatomy/i }).length).toBeGreaterThan(0);
  });

  it("shows a graceful dataset-not-installed state on the liver route", async () => {
    renderTeaching("/teaching/anatomy/liver");
    expect(await screen.findByRole("heading", { name: "Liver anatomy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Dataset not installed" })).toBeTruthy();
  });

  it("renders an available atlas, selects Segment VIII, and toggles its label-33 overlay", async () => {
    anatomyMocks.fetchManifest.mockResolvedValue({ available: true, manifest } satisfies TeachingAnatomyManifestResult);
    renderTeaching("/teaching/anatomy/liver");
    expect(await screen.findByRole("heading", { name: "3D anatomy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Axial CT" })).toBeTruthy();
    await waitFor(() => expect(anatomyMocks.loadVolumes).toHaveBeenCalledWith(manifest, expect.any(AbortSignal)));
    const volumeView = screen.getByTestId("mock-ct-viewer");
    expect(volumeView.getAttribute("data-overlay-enabled")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Select Segment VIII in 3D" }));
    expect(screen.getAllByText("Liver Segment VIII").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Selected structure" }));
    expect(volumeView.getAttribute("data-overlay-enabled")).toBe("true");
    expect(volumeView.getAttribute("data-selected-label")).toBe("33");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next slice" })));
    expect(volumeView.getAttribute("data-slice")).toBe("2");
  });
});
