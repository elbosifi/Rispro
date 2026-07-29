import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const MAX_PAGES = 100;
const MAX_PAGE_PIXELS = 40_000_000;

export type RenderedClinicalDocument = { directory: string; pages: Array<{ pageNumber: number; path: string; rows: number; columns: number }> };

export async function renderClinicalDocument(source: Buffer, mimeType: string): Promise<RenderedClinicalDocument> {
  const directory = await mkdtemp(join(tmpdir(), "rispro-clinical-document-"));
  try {
    const mime = String(mimeType || "").toLowerCase();
    if (mime === "application/pdf") {
      const input = join(directory, "source.pdf");
      await writeFile(input, source);
      await execFileAsync("pdftoppm", ["-r", "180", "-png", input, join(directory, "page")], { timeout: 120_000, maxBuffer: 1024 * 1024 });
    } else if (mime === "image/jpeg" || mime === "image/png") {
      await writeFile(join(directory, "page-1.png"), await sharp(source, { failOn: "error" }).flatten({ background: "#ffffff" }).png().toBuffer());
    } else throw new Error("Unsupported clinical document source type.");
    const files = (await (await import("node:fs/promises")).readdir(directory)).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    if (!files.length || files.length > MAX_PAGES) throw new Error("Clinical document page count is outside the supported export limit.");
    const pages = [];
    for (let index = 0; index < files.length; index += 1) {
      const path = join(directory, files[index]!); const meta = await sharp(path).metadata();
      if (!meta.width || !meta.height || meta.width * meta.height > MAX_PAGE_PIXELS) throw new Error("Clinical document rendered page dimensions exceed the export limit.");
      pages.push({ pageNumber: index + 1, path, rows: meta.height, columns: meta.width });
    }
    return { directory, pages };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export async function readRenderedRgbPage(path: string): Promise<Buffer> { return sharp(await readFile(path)).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer(); }
export async function cleanupRenderedClinicalDocument(rendered: RenderedClinicalDocument | null): Promise<void> { if (rendered) await rm(rendered.directory, { recursive: true, force: true }); }
