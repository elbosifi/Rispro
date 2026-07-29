import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const MAX_PAGES = 100;
const MAX_PAGE_PIXELS = 40_000_000;
const MAX_TOTAL_PIXELS = 120_000_000;
const MAX_RENDER_DIMENSION = 6000;

export type RenderedClinicalDocument = { directory: string; pages: Array<{ pageNumber: number; path: string; rows: number; columns: number }> };
export type ClinicalDocumentRenderOptions = { onProgress?: (phase: "before_render" | "page_rendered" | "before_prepare", pageNumber?: number) => Promise<void> | void };

export function parsePdfInfoPageSizes(output: string, pageCount: number): Array<{ widthPoints: number; heightPoints: number }> {
  const found = new Map<number, { widthPoints: number; heightPoints: number }>();
  const expression = /^Page(?:\s+(\d+))?\s+size:\s*([\d.]+)\s+x\s+([\d.]+)\s+pts(?:\s+\([^\r\n)]*\))?\s*$/gim;
  for (const match of output.matchAll(expression)) {
    const page = Number(match[1] || (pageCount === 1 ? 1 : 0)); const widthPoints = Number(match[2]); const heightPoints = Number(match[3]);
    if (!Number.isInteger(page) || page < 1 || page > pageCount || found.has(page) || !Number.isFinite(widthPoints) || !Number.isFinite(heightPoints) || widthPoints <= 0 || heightPoints <= 0) throw new Error("Clinical document page dimensions could not be determined.");
    found.set(page, { widthPoints, heightPoints });
  }
  if (found.size !== pageCount) throw new Error("Clinical document page dimensions could not be determined.");
  return Array.from({ length: pageCount }, (_, index) => found.get(index + 1)!);
}

export function projectedRenderedDimensions(widthPoints: number, heightPoints: number): { width: number; height: number; pixels: number; scaled: boolean } {
  const width = widthPoints * 2.5; const height = heightPoints * 2.5;
  const scale = Math.min(1, MAX_RENDER_DIMENSION / Math.max(width, height), Math.sqrt(MAX_PAGE_PIXELS / (width * height)));
  const projectedWidth = Math.max(1, Math.round(width * scale)); const projectedHeight = Math.max(1, Math.round(height * scale));
  return { width: projectedWidth, height: projectedHeight, pixels: projectedWidth * projectedHeight, scaled: scale < 1 };
}

export async function renderClinicalDocument(source: Buffer, mimeType: string, options: ClinicalDocumentRenderOptions = {}): Promise<RenderedClinicalDocument> {
  const directory = await mkdtemp(join(tmpdir(), "rispro-clinical-document-"));
  try {
    const mime = String(mimeType || "").toLowerCase();
    if (mime === "application/pdf") {
      const input = join(directory, "source.pdf");
      await writeFile(input, source);
      const commandOptions = { timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C" } };
      const info = await execFileAsync("pdfinfo", [input], commandOptions);
      const pageCount = Number((`${info.stdout}\n${info.stderr}`).match(/^Pages:\s*(\d+)\s*$/mi)?.[1]);
      if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) throw new Error("Clinical document page count is outside the supported export limit.");
      const boxInfo = await execFileAsync("pdfinfo", ["-box", "-f", "1", "-l", String(pageCount), input], commandOptions);
      const sizes = parsePdfInfoPageSizes(`${boxInfo.stdout}\n${boxInfo.stderr}`, pageCount);
      const projections = sizes.map((size) => projectedRenderedDimensions(size.widthPoints, size.heightPoints));
      if (projections.reduce((total, projection) => total + projection.pixels, 0) > MAX_TOTAL_PIXELS) throw new Error("Clinical document rendered total pixels exceed the export limit.");
      await options.onProgress?.("before_render");
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const projection = projections[pageNumber - 1]!;
        await execFileAsync("pdftoppm", ["-r", "180", ...(projection.scaled ? ["-scale-to", String(MAX_RENDER_DIMENSION)] : []), "-f", String(pageNumber), "-l", String(pageNumber), "-png", input, join(directory, "page")], { timeout: 120_000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C" } });
        await options.onProgress?.("page_rendered", pageNumber);
      }
    } else if (mime === "image/jpeg" || mime === "image/png") {
      await writeFile(join(directory, "page-1.png"), await sharp(source, { failOn: "error", limitInputPixels: MAX_PAGE_PIXELS }).resize({ width: MAX_RENDER_DIMENSION, height: MAX_RENDER_DIMENSION, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).toColourspace("srgb").removeAlpha().png().toBuffer());
    } else throw new Error("Unsupported clinical document source type.");
    const files = (await (await import("node:fs/promises")).readdir(directory)).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    if (!files.length || files.length > MAX_PAGES) throw new Error("Clinical document page count is outside the supported export limit.");
    const pages = []; let totalPixels = 0;
    for (let index = 0; index < files.length; index += 1) {
      const path = join(directory, files[index]!); const meta = await sharp(path, { limitInputPixels: MAX_PAGE_PIXELS }).metadata();
      if (!meta.width || !meta.height || meta.width * meta.height > MAX_PAGE_PIXELS) throw new Error("Clinical document rendered page dimensions exceed the export limit.");
      totalPixels += meta.width * meta.height; if (totalPixels > MAX_TOTAL_PIXELS) throw new Error("Clinical document rendered total pixels exceed the export limit.");
      pages.push({ pageNumber: index + 1, path, rows: meta.height, columns: meta.width });
    }
    await options.onProgress?.("before_prepare"); return { directory, pages };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export async function readRenderedRgbPage(path: string): Promise<Buffer> { return sharp(await readFile(path), { limitInputPixels: MAX_PAGE_PIXELS }).flatten({ background: "#ffffff" }).toColourspace("srgb").removeAlpha().raw().toBuffer(); }
export async function cleanupRenderedClinicalDocument(rendered: RenderedClinicalDocument | null): Promise<void> { if (rendered) await rm(rendered.directory, { recursive: true, force: true }); }
