import { expect, test } from "@playwright/test";
import { signInWithSession } from "../helpers/auth";

const width = 16;
const height = 16;
const depth = 5;
const origin = [-5, -5, -4] as const;
const directions = [[0.7, 0, 0], [0, 0.7, 0], [0, 0, 2]] as const;
const segmentCenter = [origin[0] + 8 * directions[0][0], origin[1] + 8 * directions[1][1], origin[2] + 2 * directions[2][2]];

function createNrrd(values: number[]): Buffer {
  const header = Buffer.from([
    "NRRD0005", "type: short", "dimension: 3", "space: left-posterior-superior", `sizes: ${width} ${height} ${depth}`,
    "space directions: (0.7,0,0) (0,0.7,0) (0,0,2)", `space origin: (${origin.join(",")})`, "encoding: raw", "endian: little", "", "",
  ].join("\n"));
  const data = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => data.writeInt16LE(value, index * 2));
  return Buffer.concat([header, data]);
}

function createSegmentMesh(): Buffer {
  const data = Buffer.alloc(134);
  data.write("Synthetic Segment VIII", 0, "ascii");
  data.writeUInt32LE(1, 80);
  const [cx, cy, cz] = segmentCenter;
  const vertices = [[cx - 1, cy - 0.6, cz], [cx + 1, cy - 0.6, cz], [cx, cy + 1.2, cz]];
  vertices.forEach((vertex, index) => vertex.forEach((coordinate, axis) => data.writeFloatLE(coordinate, 96 + index * 12 + axis * 4)));
  return data;
}

test("Teaching Liver Anatomy 3D, CT stack, physical slice plane, and Segment VIII overlay smoke", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithSession(page, "e2e_doctor");
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));

  const ctValues = Array(width * height * depth).fill(0);
  const labelValues = Array(width * height * depth).fill(0);
  labelValues[8 + width * (8 + height * 2)] = 33;
  const ctBytes = createNrrd(ctValues);
  const labelBytes = createNrrd(labelValues);
  const meshBytes = createSegmentMesh();
  const manifest = {
    schemaVersion: "2.0",
    atlasId: "spl-liver",
    title: "SPL Liver Atlas",
    bodyRegion: "Abdomen",
    organs: ["Liver"],
    systems: ["Gastrointestinal", "Vascular"],
    modality: "CT",
    correlatedImaging: true,
    supportedPlanes: ["axial", "coronal", "sagittal"],
    coordinateSystem: "LPS",
    meshCoordinateSystem: "LPS",
    volumes: {
      primary: { assetKey: "ct", file: "ct.nrrd", modality: "CT", windowLevel: { width: 400, level: 40 } },
      segmentation: { assetKey: "labels", file: "labels.nrrd" },
    },
    assets: {
      ct: { file: "ct.nrrd", mediaType: "application/octet-stream" },
      labels: { file: "labels.nrrd", mediaType: "application/octet-stream" },
      "mesh-segment-viii": { file: "segment-viii.stl", mediaType: "model/stl" },
    },
    structures: [{ id: "segment-viii", labelValue: 33, name: "Liver Segment VIII", category: "Liver segments", synonyms: [], color: "#53ad7a", meshAsset: "mesh-segment-viii", note: "Anterosuperior right liver between the middle and right hepatic veins." }],
    provenance: { sourceRepository: "https://github.com/lorensen/SPLLiverAtlas", project: "SPL Liver Atlas", attribution: "Synthetic smoke-test fixture.", license: "3D Slicer license.", licenseUrl: "https://www.openanatomy.org/atlas-pages/slicer-license.html", use: "Synthetic test fixture." },
    spatialValidation: { status: "passed", method: "Synthetic E2E geometry fixture.", minimumMeshLabelAgreement: 0.2, meshLabelAgreement: { "segment-viii": 0.5 } },
  };

  await page.route("**/api/teaching/anatomy/atlas/spl-liver/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/manifest")) return route.fulfill({ json: { available: true, manifest } });
    if (pathname.endsWith("/assets/ct")) return route.fulfill({ contentType: "application/octet-stream", body: ctBytes });
    if (pathname.endsWith("/assets/labels")) return route.fulfill({ contentType: "application/octet-stream", body: labelBytes });
    if (pathname.endsWith("/assets/mesh-segment-viii")) return route.fulfill({ contentType: "model/stl", body: meshBytes });
    return route.fulfill({ status: 404, json: { message: "Synthetic atlas asset not found." } });
  });

  await page.goto("/teaching/anatomy/liver");
  await expect(page.getByRole("heading", { name: "Liver anatomy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "3D anatomy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Axial CT" })).toBeVisible();
  const modelCanvas = page.locator('div[aria-label^="Interactive 3D anatomy model"] canvas');
  await expect(modelCanvas).toBeVisible();
  await page.waitForFunction(() => (document.querySelector<HTMLCanvasElement>('div[aria-label^="Interactive 3D anatomy model"] canvas')?.width ?? 0) > 0);

  const modelBox = await modelCanvas.boundingBox();
  expect(modelBox).toBeTruthy();
  await modelCanvas.click({ position: { x: modelBox!.width / 2, y: modelBox!.height / 2 } });
  await expect(page.getByText("Liver Segment VIII")).toHaveCount(2);
  await page.getByRole("button", { name: "Selected structure" }).click();
  await expect(page.getByRole("button", { name: "Selected structure" })).toHaveAttribute("aria-pressed", "true");

  const ctCanvas = page.locator('canvas[aria-label^="Axial CT slice"]');
  await expect.poll(async () => ctCanvas.evaluate((canvas) => {
    const data = canvas.getContext("2d")!.getImageData(8, 8, 1, 1).data;
    return data[1]! > data[0]!;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-segment-viii-synthetic.png"), fullPage: true });

  await page.getByRole("button", { name: "Coronal" }).click();
  await expect(page.getByRole("heading", { name: "Coronal CT" })).toBeVisible();
  await expect(page.getByText("Slice 9 of 17")).toBeVisible();
  await expect(page.locator('div[aria-label^="Interactive 3D anatomy model"]')).toHaveAttribute("data-slice-plane", "coronal");
  await page.getByRole("button", { name: "Sagittal" }).click();
  await expect(page.getByRole("heading", { name: "Sagittal CT" })).toBeVisible();
  await expect(page.getByText("Slice 9 of 17")).toBeVisible();
  await expect(page.locator('div[aria-label^="Interactive 3D anatomy model"]')).toHaveAttribute("data-slice-plane", "sagittal");
  await page.getByRole("button", { name: "Axial" }).click();
  await expect(page.getByRole("heading", { name: "Axial CT" })).toBeVisible();

  const slider = page.getByRole("slider", { name: "Axial slice" });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("3");
  const modelHost = page.locator('div[aria-label^="Interactive 3D anatomy model"]');
  await expect(modelHost).toHaveAttribute("data-slice-index", "3");
  await expect(modelHost).toHaveAttribute("data-slice-world-origin", "0.25,0.25,-2");
  await expect(page.getByText("Slice 4 of 5")).toBeVisible();
});

test("Teaching Anatomy catalog preserves source terms and loads large whole-body meshes on selection", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await signInWithSession(page, "e2e_doctor");
  await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));

  const attribution = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International";
  const structures = Array.from({ length: 41 }, (_, index) => ({
    id: `part-${index + 1}`,
    name: `Part ${index + 1}`,
    category: "BodyParts3D",
    synonyms: [`FMA${index + 1}`],
    color: "#53ad7a",
    meshAsset: `mesh-part-${index + 1}`,
    note: `Synthetic test surface ${index + 1}.`,
  }));
  const assets = Object.fromEntries(structures.map((structure) => [structure.meshAsset, {
    file: `${structure.id}.obj`,
    mediaType: "model/obj",
  }]));
  const manifest = {
    schemaVersion: "2.0",
    atlasId: "bodyparts3d",
    title: "Whole-body 3D Navigator",
    bodyRegion: "Whole body",
    organs: ["Liver"],
    systems: ["Musculoskeletal"],
    modality: "3D",
    correlatedImaging: false,
    supportedPlanes: [],
    coordinateSystem: "LPS",
    meshCoordinateSystem: "LPS",
    volumes: {},
    assets,
    structures,
    provenance: {
      sourceRepository: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/",
      project: "BodyParts3D 4.0 PART-OF tree",
      attribution,
      license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
      licenseUrl: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
      use: "Synthetic adult male, non-clinical browser fixture.",
    },
    spatialValidation: { status: "not-applicable", method: "Independent synthetic 3D reference." },
  };
  const catalogItem = {
    atlasId: "bodyparts3d",
    title: manifest.title,
    bodyRegion: manifest.bodyRegion,
    organs: manifest.organs,
    systems: manifest.systems,
    modality: "3D",
    crossSectionPlanes: [],
    description: "Whole-body 3D search and navigation.",
    correlatedImaging: false,
    status: "ready",
    structureCount: structures.length,
    provenance: {
      sourceRepository: manifest.provenance.sourceRepository,
      project: manifest.provenance.project,
      attribution,
      license: manifest.provenance.license,
      licenseUrl: manifest.provenance.licenseUrl,
      use: manifest.provenance.use,
    },
  };
  const requestedAssets: string[] = [];
  await page.route("**/api/teaching/anatomy/catalog", (route) => route.fulfill({ json: { items: [catalogItem] } }));
  await page.route("**/api/teaching/anatomy/atlas/bodyparts3d/manifest", (route) => route.fulfill({ json: { available: true, manifest } }));
  await page.route("**/api/teaching/anatomy/atlas/bodyparts3d/assets/*", async (route) => {
    const assetKey = new URL(route.request().url()).pathname.split("/").at(-1)!;
    requestedAssets.push(assetKey);
    return route.fulfill({ contentType: "model/obj", body: "o surface\nv -1 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n" });
  });

  await page.goto("/teaching/anatomy");
  await expect(page.getByRole("heading", { name: "Anatomy atlas library" })).toBeVisible();
  await expect(page.getByText("Whole body · 3D")).toBeVisible();
  await page.getByRole("link", { name: "Sources & licenses" }).click();
  await expect(page.getByText(attribution)).toBeVisible();
  await expect(page.getByText("Creative Commons Attribution 4.0 International (CC BY 4.0)")).toBeVisible();
  await expect(page.getByText("Synthetic adult male, non-clinical browser fixture.")).toBeVisible();
  await page.getByLabel("Breadcrumb").getByRole("link", { name: "Anatomy", exact: true }).click();
  await page.getByRole("link", { name: "Open Whole-body 3D Navigator" }).click();

  await expect(page.getByRole("heading", { name: "Whole-body 3D Navigator" })).toBeVisible();
  await expect(page.getByText("Select a surface in the structure list to load it in 3D.")).toBeVisible();
  expect(requestedAssets).toHaveLength(0);
  await page.getByRole("textbox", { name: "Search structures and synonyms" }).fill("Part 41");
  await page.getByRole("button", { name: "Part 41", exact: true }).click();
  await expect(page.getByText("Synthetic test surface 41.")).toBeVisible();
  await expect.poll(() => requestedAssets.length).toBe(1);
  expect(requestedAssets).toEqual(["mesh-part-41"]);
  await expect(page.getByText("Cross-sectional reference atlas not yet available.", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Whole-body 3D Navigator" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search structures and synonyms" })).toBeVisible();
  const pageWidths = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(pageWidths.content).toBeLessThanOrEqual(pageWidths.viewport);
  await page.screenshot({ path: testInfo.outputPath("teaching-anatomy-whole-body-mobile.png"), fullPage: true });
});
