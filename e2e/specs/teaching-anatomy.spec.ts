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
    structures: [{ id: "segment-viii", labelValue: 33, name: "Liver Segment VIII", category: "Liver segments", color: "#53ad7a", meshAsset: "mesh-segment-viii", note: "Anterosuperior right liver between the middle and right hepatic veins." }],
    provenance: { sourceRepository: "https://github.com/lorensen/SPLLiverAtlas", project: "SPL Liver Atlas", attribution: "Synthetic smoke-test fixture.", license: "3D Slicer license.", licenseUrl: "https://www.openanatomy.org/atlas-pages/slicer-license.html", use: "Synthetic test fixture." },
    spatialValidation: { status: "passed", method: "Synthetic E2E geometry fixture.", minimumMeshLabelAgreement: 0.2, meshLabelAgreement: { "segment-viii": 0.5 } },
  };

  await page.route("**/api/teaching/anatomy/liver/**", async (route) => {
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

  const slider = page.getByRole("slider", { name: "CT slice" });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("3");
  const modelHost = page.locator('div[aria-label^="Interactive 3D anatomy model"]');
  await expect(modelHost).toHaveAttribute("data-slice-index", "3");
  await expect(modelHost).toHaveAttribute("data-slice-world-origin", "-5,-5,2");
  await expect(page.getByText("Slice 4 of 5")).toBeVisible();
});
