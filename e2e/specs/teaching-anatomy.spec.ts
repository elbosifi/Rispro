import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

const width = 16;
const height = 16;
const depth = 5;
const origin = [-5, -5, -4] as const;
const directions = [[0.7, 0, 0], [0, 0.7, 0], [0, 0, 2]] as const;
const segmentCenter = [0.6, 0.6, 0] as const;

function createNrrd(values: number[]): Buffer {
  const header = Buffer.from([
    "NRRD0005", "type: short", "dimension: 3", "space: left-posterior-superior", `sizes: ${width} ${height} ${depth}`,
    `space directions: (${directions[0].join(",")}) (${directions[1].join(",")}) (${directions[2].join(",")})`,
    `space origin: (${origin.join(",")})`, "encoding: raw", "endian: little", "", "",
  ].join("\n"));
  const data = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => data.writeInt16LE(value, index * 2));
  return Buffer.concat([header, data]);
}

function createSegmentMesh(): Buffer {
  const data = Buffer.alloc(134);
  data.write("Synthetic segment surface", 0, "ascii");
  data.writeUInt32LE(1, 80);
  const [cx, cy, cz] = segmentCenter;
  const vertices = [[cx - 1, cy - 0.6, cz], [cx + 1, cy - 0.6, cz], [cx, cy + 1.2, cz]];
  vertices.forEach((vertex, index) => vertex.forEach((coordinate, axis) => data.writeFloatLE(coordinate, 96 + index * 12 + axis * 4)));
  return data;
}

function catalogItem(atlasId: string, title: string, modality: "CT" | "MRI" | "3D", structureCount: number) {
  return {
    atlasId, title, bodyRegion: "Synthetic region", organs: [title], systems: ["Synthetic system"], modality,
    crossSectionPlanes: modality === "3D" ? [] : ["axial", "coronal", "sagittal"],
    description: "Synthetic browser journey fixture.", correlatedImaging: modality !== "3D", status: "ready", structureCount,
    provenance: { sourceRepository: "https://example.org/source", project: title, attribution: "Synthetic browser fixture.", license: "CC BY 4.0", licenseUrl: "https://example.org/license" },
  };
}

async function authenticate(page: Parameters<typeof signInWithSession>[0]) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithSession(page, "e2e_doctor");
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
}

test("atlas cards navigate from their main area while provenance links remain separate", async ({ page }) => {
  await authenticate(page);
  const unavailable = { ...catalogItem("bodyparts3d", "Whole-body 3D Navigator", "3D", 0), status: "unavailable", structureCount: null };
  await page.route("**/api/teaching/anatomy/catalog", (route) => route.fulfill({ json: { items: [catalogItem("spl-liver", "SPL Liver Atlas", "CT", 1), unavailable] } }));
  await page.goto("/teaching/anatomy");
  const liverLink = page.getByRole("link", { name: "SPL Liver Atlas" });
  await expect(liverLink).toHaveAttribute("href", "/teaching/anatomy/atlas/spl-liver");
  await expect(page.getByRole("link", { name: "Whole-body 3D Navigator" })).toHaveAttribute("href", "/teaching/anatomy/atlas/bodyparts3d");
  await expect(page.getByRole("link", { name: "License terms" }).first()).toHaveAttribute("href", "https://example.org/license");
  await expect(page.getByRole("link", { name: "Source", exact: true }).first()).toHaveAttribute("href", "https://example.org/source");
  await page.getByText("Synthetic browser journey fixture.").first().click();
  await expect(page).toHaveURL(/\/teaching\/anatomy\/atlas\/spl-liver$/);
  await page.goto("/teaching/anatomy");
  await page.getByRole("link", { name: "Whole-body 3D Navigator" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/teaching\/anatomy\/atlas\/bodyparts3d$/);
});

test("SPL Liver correlated workspace synchronizes three MPRs, 3D planes, interaction, and mobile fallback", async ({ page }, testInfo) => {
  await authenticate(page);
  const ctValues = Array.from({ length: width * height * depth }, (_, index) => index % 120);
  const labelValues = Array(width * height * depth).fill(0);
  labelValues[8 + width * (8 + height * 2)] = 33;
  const ctBytes = createNrrd(ctValues);
  const labelBytes = createNrrd(labelValues);
  const meshBytes = createSegmentMesh();
  const manifest = {
    schemaVersion: "2.0", atlasId: "spl-liver", title: "SPL Liver Atlas", bodyRegion: "Abdomen", organs: ["Liver"],
    systems: ["Gastrointestinal", "Vascular"], modality: "CT", correlatedImaging: true,
    supportedPlanes: ["axial", "coronal", "sagittal"], coordinateSystem: "LPS", meshCoordinateSystem: "LPS",
    volumes: {
      primary: { assetKey: "ct", file: "ct.nrrd", modality: "CT", windowLevel: { width: 400, level: 40 }, displayPresets: [
        { id: "soft-tissue", label: "Soft tissue", windowLevel: { width: 400, level: 40 } },
        { id: "bone", label: "Bone", windowLevel: { width: 2000, level: 300 } },
        { id: "lung", label: "Lung", windowLevel: { width: 1500, level: -600 } },
      ] },
      segmentation: { assetKey: "labels", file: "labels.nrrd" },
    },
    assets: {
      ct: { file: "ct.nrrd", mediaType: "application/octet-stream" },
      labels: { file: "labels.nrrd", mediaType: "application/octet-stream" },
      "mesh-segment-viii": { file: "segment-viii.stl", mediaType: "model/stl" },
    },
    structures: [{ id: "segment-viii", labelValue: 33, name: "Liver Segment VIII", category: "Liver segments", synonyms: [], color: "#53ad7a", meshAsset: "mesh-segment-viii", representativePointLps: segmentCenter, radiologyNote: "Synthetic representative-point fixture." }],
    provenance: { sourceRepository: "https://github.com/lorensen/SPLLiverAtlas", project: "SPL Liver Atlas", attribution: "Synthetic smoke-test fixture.", license: "3D Slicer license.", licenseUrl: "https://www.openanatomy.org/atlas-pages/slicer-license.html", use: "Synthetic browser journey fixture." },
    spatialValidation: { status: "passed", method: "Synthetic E2E geometry fixture.", minimumMeshLabelAgreement: 0.2, meshLabelAgreement: { "segment-viii": 0.5 } },
  };
  await page.route("**/api/teaching/anatomy/catalog", (route) => route.fulfill({ json: { items: [catalogItem("spl-liver", manifest.title, "CT", 1)] } }));
  await page.route("**/api/teaching/anatomy/atlas/spl-liver/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/manifest")) return route.fulfill({ json: { available: true, manifest } });
    if (pathname.endsWith("/assets/ct")) return route.fulfill({ contentType: "application/octet-stream", body: ctBytes });
    if (pathname.endsWith("/assets/labels")) return route.fulfill({ contentType: "application/octet-stream", body: labelBytes });
    if (pathname.endsWith("/assets/mesh-segment-viii")) return route.fulfill({ contentType: "model/stl", body: meshBytes });
    return route.fulfill({ status: 404, json: { message: "Synthetic atlas asset not found." } });
  });

  await page.goto("/teaching/anatomy/liver");
  await expect(page.getByRole("heading", { name: "SPL Liver Atlas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "3D anatomy" })).toBeVisible();
  const axial = page.getByLabel("axial CT radiology view");
  const sagittal = page.getByLabel("sagittal CT radiology view");
  const coronal = page.getByLabel("coronal CT radiology view");
  for (const viewport of [axial, sagittal, coronal]) await expect(viewport).toBeVisible();
  const modelHost = page.locator('div[aria-label^="Interactive 3D anatomy model"]');
  const modelCanvas = modelHost.locator("canvas");
  await expect(modelCanvas).toBeVisible();
  await expect.poll(() => modelHost.getAttribute("data-section-planes-world-point-lps")).toBe("0.25,0.25,0");
  await expect(modelHost).toHaveAttribute("data-section-plane-count", "3");
  await expect(modelHost).toHaveAttribute("data-section-planes-visible", "true");

  await page.getByRole("textbox", { name: "Search structures and synonyms" }).fill("Liver Segment VIII");
  await page.getByRole("button", { name: "Liver Segment VIII", exact: true }).click();
  for (const viewport of [axial, sagittal, coronal]) await expect(viewport).toHaveAttribute("data-world-point-lps", "0.6,0.6,0");
  await expect(modelHost).toHaveAttribute("data-section-planes-world-point-lps", "0.6,0.6,0");
  await page.getByRole("button", { name: "Selected structure" }).click();
  for (const viewport of [axial, sagittal, coronal]) {
    await expect(viewport).toHaveAttribute("data-overlay-enabled", "true");
    await expect(viewport).toHaveAttribute("data-selected-label", "33");
  }

  await axial.focus();
  await axial.press("ArrowRight");
  for (const viewport of [axial, sagittal, coronal]) await expect(viewport).toHaveAttribute("data-world-point-lps", "0.6,0.6,-2");
  await expect(axial).toHaveAttribute("data-plane-index", "3");
  await expect(modelHost).toHaveAttribute("data-section-planes-world-point-lps", "0.6,0.6,-2");

  const coronalCanvas = coronal.locator("canvas");
  const coronalBox = await coronalCanvas.boundingBox();
  expect(coronalBox).toBeTruthy();
  await page.mouse.click(coronalBox!.x + coronalBox!.width * 0.38, coronalBox!.y + coronalBox!.height * 0.62);
  const clickedPoint = await coronal.getAttribute("data-world-point-lps");
  expect(clickedPoint).not.toBe("0.6,0.6,-2");
  for (const viewport of [axial, sagittal, coronal]) await expect(viewport).toHaveAttribute("data-world-point-lps", clickedPoint!);
  await expect(modelHost).toHaveAttribute("data-section-planes-world-point-lps", clickedPoint!);

  await page.getByLabel("axial display preset").selectOption("bone");
  await expect(page.getByText("W 2000 L 300")).toBeVisible();
  const axialCanvas = axial.locator("canvas");
  const axialBox = await axialCanvas.boundingBox();
  expect(axialBox).toBeTruthy();
  await page.mouse.move(axialBox!.x + axialBox!.width / 2, axialBox!.y + axialBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(axialBox!.x + axialBox!.width / 2 + 25, axialBox!.y + axialBox!.height / 2 + 12, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByText("W 2100 L 276")).toBeVisible();
  await page.getByRole("button", { name: "Reset W/L" }).first().click();
  await expect(page.getByText("W 400 L 40", { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Hide section planes" }).click();
  await expect(modelHost).toHaveAttribute("data-section-planes-visible", "false");
  await page.getByRole("button", { name: "Show section planes" }).click();
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-liver-4up-synthetic.png"), fullPage: true });

  const fullscreenButton = page.getByRole("button", { name: "Enter full screen radiology workspace" });
  await fullscreenButton.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.getByRole("button", { name: "Exit full screen radiology workspace" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tablist", { name: "Radiology viewport" })).toBeVisible();
  await expect(axial).toBeVisible();
  await expect(sagittal).toBeHidden();
  await page.getByRole("tab", { name: "Coronal" }).click();
  await expect(coronal).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-liver-mobile-synthetic.png"), fullPage: true });
});

test("SPL Knee MRI uses intensity display and structure selection navigates the shared MPR point", async ({ page }) => {
  await authenticate(page);
  const values = Array.from({ length: width * height * depth }, (_, index) => index % 1000);
  const labelValues = Array(width * height * depth).fill(0);
  labelValues[8 + width * (8 + height * 2)] = 17;
  const mrBytes = createNrrd(values);
  const labelBytes = createNrrd(labelValues);
  const manifest = {
    schemaVersion: "2.0", atlasId: "spl-knee", title: "SPL Knee Atlas", bodyRegion: "Lower limb", organs: ["Knee"],
    systems: ["Musculoskeletal"], modality: "MRI", correlatedImaging: true, supportedPlanes: ["axial", "coronal", "sagittal"],
    coordinateSystem: "LPS", meshCoordinateSystem: "LPS",
    volumes: { primary: { assetKey: "mr", file: "knee-mr.nrrd", modality: "MRI", intensityRange: { min: 0, max: 999 }, displayPresets: [{ id: "dataset-default", label: "Dataset default intensity", intensityRange: { min: 0, max: 999 } }] }, segmentation: { assetKey: "labels", file: "knee-labels.nrrd" } },
    assets: { mr: { file: "knee-mr.nrrd", mediaType: "application/octet-stream" }, labels: { file: "knee-labels.nrrd", mediaType: "application/octet-stream" } },
    structures: [{ id: "femur", labelValue: 17, name: "Femur", category: "Bones", synonyms: [], color: "#53ad7a", representativePointLps: segmentCenter, relatedAtlasIds: ["spl-knee"] }],
    provenance: { sourceRepository: "https://www.openanatomy.org/atlas-pages/atlas-spl-knee.html", project: "SPL Knee Atlas", attribution: "Synthetic browser fixture.", license: "3D Slicer license.", licenseUrl: "https://www.openanatomy.org/atlas-pages/slicer-license.html", use: "Synthetic browser journey fixture." },
    spatialValidation: { status: "passed", method: "Synthetic E2E geometry fixture.", minimumMeshLabelAgreement: 0.2, meshLabelAgreement: {} },
  };
  await page.route("**/api/teaching/anatomy/catalog", (route) => route.fulfill({ json: { items: [catalogItem("spl-knee", manifest.title, "MRI", 1)] } }));
  await page.route("**/api/teaching/anatomy/atlas/spl-knee/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/manifest")) return route.fulfill({ json: { available: true, manifest } });
    if (pathname.endsWith("/assets/mr")) return route.fulfill({ contentType: "application/octet-stream", body: mrBytes });
    if (pathname.endsWith("/assets/labels")) return route.fulfill({ contentType: "application/octet-stream", body: labelBytes });
    return route.fulfill({ status: 404, json: { message: "Synthetic atlas asset not found." } });
  });

  await page.goto("/teaching/anatomy/atlas/spl-knee");
  await expect(page.getByRole("heading", { name: "SPL Knee Atlas" })).toBeVisible();
  const views = ["axial", "sagittal", "coronal"].map((plane) => page.getByLabel(`${plane} MRI radiology view`));
  for (const view of views) await expect(view).toBeVisible();
  await expect(page.getByText("MRI intensity 0 to 999").first()).toBeVisible();
  await expect(page.getByText(/Hounsfield|window\/level/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Femur", exact: true }).click();
  for (const view of views) await expect(view).toHaveAttribute("data-world-point-lps", "0.6,0.6,0");
  await page.getByRole("button", { name: "Selected structure" }).click();
  for (const view of views) {
    await expect(view).toHaveAttribute("data-overlay-enabled", "true");
    await expect(view).toHaveAttribute("data-selected-label", "17");
  }
  await page.getByLabel("sagittal display preset").selectOption("dataset-default");
  await page.getByRole("button", { name: "Reset intensity" }).first().click();
});

test("BodyParts3D initial overview retains context through generic anatomy selection and isolation", async ({ page }, testInfo) => {
  await authenticate(page);
  const structures: Array<{ id: string; name: string; category: string; synonyms: string[]; color: string; meshAsset?: string; parentId?: string; note: string; sourceConceptId?: string; relatedAtlasIds?: string[] }> = Array.from({ length: 40 }, (_, index) => ({ id: `part-${index + 1}`, name: `Part ${index + 1}`, category: "BodyParts3D", synonyms: [`FMA${index + 1}`], color: "#aab6c5", meshAsset: `mesh-part-${index + 1}`, note: "Synthetic selection fixture." }));
  structures.push(
    { id: "liver", name: "Liver", category: "BodyParts3D", synonyms: ["FMA7197"], sourceConceptId: "FMA7197", color: "#53ad7a", relatedAtlasIds: ["spl-liver"], note: "Stable source concept mapping." },
    { id: "liver-lobe", parentId: "liver", name: "Liver lobe surface", category: "BodyParts3D", synonyms: [], color: "#53ad7a", meshAsset: "mesh-liver-lobe", note: "Source descendant geometry." },
    { id: "knee", name: "Knee", category: "BodyParts3D", synonyms: ["FMA24977"], sourceConceptId: "FMA24977", color: "#53ad7a", meshAsset: "mesh-knee", relatedAtlasIds: ["spl-knee"], note: "Stable source concept mapping." },
  );
  const overview = Buffer.from("o RISPRO_STRUCTURE_ID_fma-7163\nv -10 0 0\nv 10 0 0\nv 0 0 80\nf 1 2 3\n");
  const assets = Object.fromEntries([
    ["whole-body-overview", { file: "whole-body-overview.obj", mediaType: "model/obj" }],
    ...structures.filter((structure) => structure.meshAsset).map((structure) => [structure.meshAsset!, { file: `${structure.id}.obj`, mediaType: "model/obj", ...(structure.id === "liver-lobe" ? { integrity: { sizeBytes: 128, sha256: "a".repeat(64) } } : {}) }]),
  ]);
  const manifest = {
    schemaVersion: "2.0", atlasId: "bodyparts3d", title: "Whole-body 3D Navigator", bodyRegion: "Whole body", organs: ["Liver", "Knee"],
    systems: ["Musculoskeletal"], modality: "3D", correlatedImaging: false, supportedPlanes: [], coordinateSystem: "LPS", meshCoordinateSystem: "LPS",
    volumes: {}, assets, overviewAsset: "whole-body-overview", structures,
    provenance: { sourceRepository: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/", project: "BodyParts3D 4.0 PART-OF tree", attribution: "Synthetic BodyParts3D browser fixture.", license: "Creative Commons Attribution 4.0 International", licenseUrl: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html", use: "Synthetic selection fixture." },
    spatialValidation: { status: "not-applicable", method: "Synthetic whole-body scene fixture." },
  };
  const requestedAssets: string[] = [];
  await page.route("**/api/teaching/anatomy/catalog", (route) => route.fulfill({ json: { items: [catalogItem("bodyparts3d", manifest.title, "3D", structures.length), catalogItem("spl-liver", "SPL Liver Atlas", "CT", 17), catalogItem("spl-knee", "SPL Knee Atlas", "MRI", 59)] } }));
  await page.route("**/api/teaching/anatomy/atlas/bodyparts3d/manifest", (route) => route.fulfill({ json: { available: true, manifest } }));
  await page.route("**/api/teaching/anatomy/atlas/bodyparts3d/assets/*", async (route) => {
    const assetKey = new URL(route.request().url()).pathname.split("/").at(-1)!;
    requestedAssets.push(assetKey);
    return route.fulfill({ contentType: "model/obj", body: assetKey === "whole-body-overview" ? overview : "o detail\nv -1 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n" });
  });

  await page.goto("/teaching/anatomy/atlas/bodyparts3d");
  await expect(page.getByRole("heading", { name: "Whole-body 3D Navigator" })).toBeVisible();
  const modelHost = page.locator('div[aria-label^="Interactive 3D anatomy model"]');
  await expect.poll(() => modelHost.getAttribute("data-whole-body-overview-loaded")).toBe("true");
  expect(requestedAssets).toEqual(["whole-body-overview"]);
  await expect(modelHost.locator("canvas")).toBeVisible();
  await page.getByRole("textbox", { name: "Search structures and synonyms" }).fill("Liver");
  await page.getByRole("button", { name: "Liver", exact: true }).click();
  await expect(modelHost).toHaveAttribute("data-loaded-structure-ids", "liver-lobe");
  await expect(modelHost).toHaveAttribute("data-selected-geometry-structure-ids", "liver-lobe");
  await expect(modelHost).toHaveAttribute("data-whole-body-overview-visible", "true");
  await expect(modelHost.locator("canvas")).toHaveCount(1);
  expect(requestedAssets).toEqual(["whole-body-overview", "mesh-liver-lobe"]);
  await expect(page.getByRole("link", { name: "Open radiology atlas: SPL Liver Atlas" })).toHaveAttribute("href", "/teaching/anatomy/atlas/spl-liver");
  await page.getByRole("button", { name: "Isolate Liver", exact: true }).click();
  await expect(modelHost).toHaveAttribute("data-whole-body-overview-visible", "false");
  await expect(modelHost).toHaveAttribute("data-loaded-structure-ids", "liver-lobe");
  await page.getByRole("button", { name: "Restore all structures" }).click();
  await expect(modelHost).toHaveAttribute("data-whole-body-overview-visible", "true");

  await page.getByRole("textbox", { name: "Search structures and synonyms" }).fill("Knee");
  await page.getByRole("button", { name: "Knee", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open radiology atlas: SPL Knee Atlas" })).toHaveAttribute("href", "/teaching/anatomy/atlas/spl-knee");
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-bodyparts3d-synthetic.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-bodyparts3d-mobile-synthetic.png"), fullPage: true });
});

test("installed BodyParts3D opens a real whole-body overview and records initial browser transfer performance", async ({ page }, testInfo) => {
  test.skip(process.env.TEACHING_ANATOMY_REAL_DATA_E2E !== "1", "requires the already-validated local anatomy sources to be provisioned");
  await authenticate(page);
  const loadStartedAt = Date.now();
  await page.goto("/teaching/anatomy");
  await expect(page.getByRole("heading", { name: "Anatomy atlas library" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Whole-body 3D Navigator" })).toBeVisible();
  await page.evaluate(() => performance.clearResourceTimings());
  await page.getByRole("link", { name: "Open Whole-body 3D Navigator" }).click();
  await expect(page.getByRole("heading", { name: "Whole-body 3D Navigator" })).toBeVisible();
  const modelHost = page.locator('div[aria-label^="Interactive 3D anatomy model"]');
  await expect.poll(() => modelHost.getAttribute("data-whole-body-overview-loaded")).toBe("true");
  await expect.poll(async () => Number(await modelHost.getAttribute("data-whole-body-overview-structure-count"))).toBeGreaterThan(0);
  await expect(page.getByText("No bounded source-surface group is available", { exact: false })).toHaveCount(0);
  const overviewReadyMs = Date.now() - loadStartedAt;
  const assetMetrics = await page.evaluate(() => {
    const entry = performance.getEntriesByType("resource").find((item) => item.name.includes("/api/teaching/anatomy/atlas/bodyparts3d/assets/whole-body-overview")) as PerformanceResourceTiming | undefined;
    return entry ? { url: entry.name, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, durationMs: Number(entry.duration.toFixed(1)) } : null;
  });
  console.log(`BODYPARTS3D_OVERVIEW_PERFORMANCE=${JSON.stringify({ overviewReadyMs, ...assetMetrics })}`);
  expect(assetMetrics).toBeTruthy();
  expect(assetMetrics!.encodedBodySize).toBeGreaterThan(0);
  await expect(modelHost.locator("canvas")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-bodyparts3d-real-initial-overview.png"), fullPage: true });
  const bodyManifestResponse = await page.request.get("http://127.0.0.1:3100/api/teaching/anatomy/atlas/bodyparts3d/manifest");
  const manifest = await bodyManifestResponse.json();
  const liver = manifest.manifest.structures.find((structure: { sourceConceptId?: string }) => structure.sourceConceptId === "FMA7197");
  const liverName = liver?.name;
  expect(liverName).toBeTruthy();
  const structuresById = new Map<string, { id: string; parentId?: string; meshAsset?: string }>(manifest.manifest.structures.map((structure: { id: string; parentId?: string; meshAsset?: string }) => [structure.id, structure]));
  const liverMeshes = manifest.manifest.structures.filter((structure: { id: string; parentId?: string; meshAsset?: string }) => {
    if (!structure.meshAsset) return false;
    let current: { id: string; parentId?: string } | undefined = structure;
    while (current) {
      if (current.id === liver.id) return true;
      current = current.parentId ? structuresById.get(current.parentId) : undefined;
    }
    return false;
  });
  expect(liverMeshes.length).toBeGreaterThan(0);
  expect(liverMeshes.length).toBeLessThanOrEqual(64);
  expect(liverMeshes.reduce((total: number, structure: { meshAsset: string }) => total + manifest.manifest.assets[structure.meshAsset].integrity.sizeBytes, 0)).toBeLessThanOrEqual(16 * 1024 * 1024);
  await page.getByRole("textbox", { name: "Search structures and synonyms" }).fill(liverName);
  await page.getByRole("button", { name: liverName, exact: true }).click();
  await expect(modelHost).toHaveAttribute("data-whole-body-overview-visible", "true");
  await expect(modelHost).toHaveAttribute("data-selected-geometry-structure-ids", liverMeshes.map((structure: { id: string }) => structure.id).join(","));
  for (const structure of liverMeshes) await expect.poll(() => modelHost.getAttribute("data-loaded-structure-ids")).toContain(structure.id);
  await expect(page.getByRole("link", { name: /Open radiology atlas: SPL Liver Atlas/ })).toHaveAttribute("href", "/teaching/anatomy/atlas/spl-liver");
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-bodyparts3d-real-liver-context.png"), fullPage: true });
  await page.getByRole("button", { name: `Isolate ${liverName}`, exact: true }).click();
  await expect(modelHost).toHaveAttribute("data-whole-body-overview-visible", "false");
  await page.getByRole("button", { name: "Restore all structures" }).click();
  await expect(modelHost).toHaveAttribute("data-whole-body-overview-visible", "true");

  if (liverMeshes.length > 0) {
    const meshAsset = liverMeshes[0].meshAsset;
    const assetSha = manifest.manifest.assets[meshAsset].integrity.sha256;
    const versionedUrl = `http://127.0.0.1:3100/api/teaching/anatomy/atlas/bodyparts3d/assets/${meshAsset}?v=${assetSha}`;
    const versioned = await page.request.get(versionedUrl);
    expect(versioned.status()).toBe(200);
    expect(versioned.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(versioned.headers().etag).toBe(`"${assetSha}"`);
    expect(versioned.headers().vary).toContain("Cookie");
    const notModified = await page.request.get(versionedUrl, { headers: { "If-None-Match": `"${assetSha}"` } });
    expect(notModified.status()).toBe(304);
    expect(notModified.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
    const legacy = await page.request.get(`http://127.0.0.1:3100/api/teaching/anatomy/atlas/bodyparts3d/assets/${meshAsset}`);
    expect(legacy.status()).toBe(200);
    expect(legacy.headers()["cache-control"]).toBe("private, max-age=0, must-revalidate");
  }

  await page.getByRole("link", { name: /Open radiology atlas: SPL Liver Atlas/ }).click();
  await expect(page.getByRole("heading", { name: "SPL Liver Atlas" })).toBeVisible();
  await page.goto("/teaching/anatomy/atlas/bodyparts3d");
  await page.getByRole("textbox", { name: "Search structures and synonyms" }).fill("Knee");
  const knee = manifest.manifest.structures.find((structure: { sourceConceptId?: string }) => structure.sourceConceptId === "FMA24977");
  expect(knee).toBeTruthy();
  await page.getByRole("button", { name: knee.name, exact: true }).click();
  await page.getByRole("link", { name: /Open radiology atlas: SPL Knee Atlas/ }).click();
  await expect(page.getByRole("heading", { name: "SPL Knee Atlas" })).toBeVisible();

  const linkedAtlases = ["spl-liver", "spl-abdomen", "spl-head-neck", "spl-knee"];
  for (const atlasId of linkedAtlases) {
    const response = await page.request.get(`http://127.0.0.1:3100/api/teaching/anatomy/atlas/${atlasId}/manifest`);
    const payload = await response.json();
    expect(payload.available, `${atlasId} is installed for this validation`).toBe(true);
    const labeled = payload.manifest.structures.filter((structure: { labelValue?: number }) => structure.labelValue !== undefined);
    expect(labeled.length, `${atlasId} has segmentation structures`).toBeGreaterThan(0);
    for (const structure of labeled) expect(structure.representativePointLps, `${atlasId}/${structure.id} representative point`).toHaveLength(3);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});

test("installed SPL Knee MRI presents synchronized views and jumps to precomputed structure points", async ({ page }) => {
  test.skip(process.env.TEACHING_ANATOMY_REAL_DATA_E2E !== "1", "requires the already-validated local anatomy sources to be provisioned");
  await authenticate(page);
  await page.goto("/teaching/anatomy");
  await page.getByRole("link", { name: "Open SPL Knee Atlas" }).click();
  await expect(page.getByRole("heading", { name: "SPL Knee Atlas" })).toBeVisible();
  const views = ["axial", "sagittal", "coronal"].map((plane) => page.getByLabel(`${plane} MRI radiology view`));
  for (const view of views) await expect(view).toBeVisible();
  await expect(page.getByText(/MRI intensity/).first()).toBeVisible();
  await expect(page.getByText(/Hounsfield/i)).toHaveCount(0);
  const response = await page.request.get("http://127.0.0.1:3100/api/teaching/anatomy/atlas/spl-knee/manifest");
  const payload = await response.json();
  const structure = payload.manifest.structures.find((entry: { name: string; labelValue?: number; representativePointLps?: number[] }) => /femur/i.test(entry.name) && entry.labelValue !== undefined && entry.representativePointLps);
  expect(structure).toBeTruthy();
  await page.getByRole("textbox", { name: "Search structures and synonyms" }).fill(structure.name);
  await page.getByRole("button", { name: structure.name, exact: true }).click();
  const point = structure.representativePointLps.join(",");
  for (const view of views) await expect(view).toHaveAttribute("data-world-point-lps", point);
  await page.getByRole("button", { name: "Selected structure" }).click();
  for (const view of views) {
    await expect(view).toHaveAttribute("data-selected-label", String(structure.labelValue));
    await expect(view).toHaveAttribute("data-overlay-enabled", "true");
  }
});

test("installed SPL Liver segment selection, axial scrolling, and coronal click share one physical point", async ({ page }, testInfo) => {
  test.skip(process.env.TEACHING_ANATOMY_REAL_DATA_E2E !== "1", "requires the already-validated local anatomy sources to be provisioned");
  await authenticate(page);
  await page.goto("/teaching/anatomy");
  await page.getByRole("link", { name: "Open SPL Liver Atlas" }).click();
  await expect(page.getByRole("heading", { name: "SPL Liver Atlas" })).toBeVisible();
  const axial = page.getByLabel("axial CT radiology view");
  const sagittal = page.getByLabel("sagittal CT radiology view");
  const coronal = page.getByLabel("coronal CT radiology view");
  for (const view of [axial, sagittal, coronal]) await expect(view).toBeVisible();
  const modelHost = page.locator('div[aria-label^="Interactive 3D anatomy model"]');
  await expect(modelHost.locator("canvas")).toBeVisible();
  await expect(modelHost).toHaveAttribute("data-section-plane-count", "3");
  const response = await page.request.get("http://127.0.0.1:3100/api/teaching/anatomy/atlas/spl-liver/manifest");
  const payload = await response.json();
  const segment = payload.manifest.structures.find((entry: { id: string }) => entry.id === "segment-viii");
  expect(segment?.representativePointLps).toHaveLength(3);
  await page.getByRole("textbox", { name: "Search structures and synonyms" }).fill(segment.name);
  await page.getByRole("button", { name: segment.name, exact: true }).click();
  const selectedPoint = segment.representativePointLps.join(",");
  for (const view of [axial, sagittal, coronal]) await expect(view).toHaveAttribute("data-world-point-lps", selectedPoint);
  await expect(modelHost).toHaveAttribute("data-section-planes-world-point-lps", selectedPoint);
  await page.getByRole("button", { name: "Selected structure" }).click();
  for (const view of [axial, sagittal, coronal]) await expect(view).toHaveAttribute("data-overlay-enabled", "true");
  await axial.focus();
  await axial.press("ArrowRight");
  const scrolledPoint = await axial.getAttribute("data-world-point-lps");
  for (const view of [sagittal, coronal]) await expect(view).toHaveAttribute("data-world-point-lps", scrolledPoint!);
  await expect(modelHost).toHaveAttribute("data-section-planes-world-point-lps", scrolledPoint!);
  const coronalCanvas = coronal.locator("canvas");
  const box = await coronalCanvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width * 0.35, box!.y + box!.height * 0.6);
  const clickedPoint = await coronal.getAttribute("data-world-point-lps");
  for (const view of [axial, sagittal]) await expect(view).toHaveAttribute("data-world-point-lps", clickedPoint!);
  await expect(modelHost).toHaveAttribute("data-section-planes-world-point-lps", clickedPoint!);
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-liver-4up-real-segment-viii.png"), fullPage: true });
});
