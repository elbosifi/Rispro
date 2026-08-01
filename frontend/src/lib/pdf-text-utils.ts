import type { jsPDF } from "jspdf";

export const NOTO_NASKH_REGULAR_URL = new URL("../assets/fonts/NotoNaskhArabic-Regular.ttf", import.meta.url).toString();
export const NOTO_NASKH_BOLD_URL = new URL("../assets/fonts/NotoNaskhArabic-Bold.ttf", import.meta.url).toString();
export const NOTO_ARABIC_FONT_FAMILY = "NotoNaskhArabic";
const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
let fontData: Promise<[string, string]> | null = null;

export function containsArabic(value: string): boolean { return ARABIC_REGEX.test(String(value || "")); }

async function loadFontAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load font: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function ensureArabicPdfFonts(doc: jsPDF): Promise<void> {
  fontData ??= Promise.all([loadFontAsBase64(NOTO_NASKH_REGULAR_URL), loadFontAsBase64(NOTO_NASKH_BOLD_URL)]);
  const [regular, bold] = await fontData;
  const instance = doc as jsPDF & { addFileToVFS?: (fileName: string, base64: string) => void; addFont?: (fileName: string, fontName: string, fontStyle: string) => void };
  if (!instance.addFileToVFS || !instance.addFont) throw new Error("jsPDF font registration is unavailable.");
  instance.addFileToVFS("NotoNaskhArabic-Regular.ttf", regular);
  instance.addFont("NotoNaskhArabic-Regular.ttf", NOTO_ARABIC_FONT_FAMILY, "normal");
  instance.addFileToVFS("NotoNaskhArabic-Bold.ttf", bold);
  instance.addFont("NotoNaskhArabic-Bold.ttf", NOTO_ARABIC_FONT_FAMILY, "bold");
}

export function processPdfText(doc: jsPDF, value: string): string {
  const cleaned = String(value || "").trim();
  const processor = (doc as jsPDF & { processArabic?: (input: string) => string }).processArabic;
  return cleaned && containsArabic(cleaned) && typeof processor === "function" ? processor(cleaned) : cleaned;
}

export function drawPdfText(doc: jsPDF, text: string, x: number, y: number, options?: { align?: "left" | "right" | "center"; bold?: boolean; maxWidth?: number }): void {
  const align = options?.align ?? "left";
  doc.setFont(NOTO_ARABIC_FONT_FAMILY, options?.bold ? "bold" : "normal");
  doc.setR2L(containsArabic(text) || align === "right");
  doc.text(processPdfText(doc, text), x, y, { align, ...(options?.maxWidth ? { maxWidth: options.maxWidth } : {}) });
  doc.setR2L(false);
}
