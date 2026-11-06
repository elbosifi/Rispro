import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const guideMarkdownPath = path.resolve("docs/bmc-product-guide/PHASE_2A_SCHEDULING_ENGINE_PILOT.md");
const pdfOutputPath = path.resolve("docs/bmc-product-guide/PHASE_2A_SCHEDULING_ENGINE_PILOT.pdf");
const screenshotsDir = path.resolve("docs/bmc-product-guide/screenshots");

console.log("Preparing PDF export of Phase 2A Pilot...");

// Simple Markdown to HTML converter for PDF generation
let md = fs.readFileSync(guideMarkdownPath, "utf8");

// Convert image paths to file URLs
md = md.replace(/!\[(.*?)\]\((file:\/\/\/.*?\/(screenshots\/.*?\.png))\)/g, (match, alt, fullUrl, relPath) => {
  const localFile = path.join(screenshotsDir, path.basename(relPath));
  return `<figure style="margin: 20px 0; text-align: center; page-break-inside: avoid;">
    <img src="${pathToFileURL(localFile).href}" style="max-width: 100%; height: auto; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.06);">
    <figcaption style="font-size: 11px; color: #64748b; margin-top: 6px; font-style: italic;">${alt}</figcaption>
  </figure>`;
});

// Convert headings
md = md.replace(/^# (.*$)/gim, '<h1 style="font-size: 26px; color: #0f172a; border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-top: 30px;">$1</h1>');
md = md.replace(/^## (.*$)/gim, '<h2 style="font-size: 20px; color: #1e3a8a; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; margin-top: 24px; page-break-after: avoid;">$1</h2>');
md = md.replace(/^### (.*$)/gim, '<h3 style="font-size: 16px; color: #334155; margin-top: 18px; page-break-after: avoid;">$1</h3>');
md = md.replace(/^#### (.*$)/gim, '<h4 style="font-size: 14px; color: #475569; margin-top: 14px; page-break-after: avoid;">$1</h4>');

// Convert tables
const tableRegex = /\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)+)/g;
md = md.replace(tableRegex, (match, header, body) => {
  const headers = header.split("|").filter(c => c.trim()).map(c => `<th style="background: #f1f5f9; padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 11px; text-align: left;">${c.trim()}</th>`).join("");
  const rows = body.trim().split("\n").map(r => {
    const cols = r.split("|").filter(c => c.trim()).map(c => `<td style="padding: 8px 10px; border: 1px solid #e2e8f0; font-size: 11px; vertical-align: top;">${c.trim()}</td>`).join("");
    return `<tr>${cols}</tr>`;
  }).join("");
  return `<table style="width: 100%; border-collapse: collapse; margin: 16px 0; page-break-inside: avoid;">
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
});

// Convert code blocks and pre
md = md.replace(/```([\s\S]*?)```/g, '<pre style="background: #0f172a; color: #f8fafc; padding: 14px; border-radius: 6px; font-size: 10px; overflow-x: auto; line-height: 1.4; page-break-inside: avoid;"><code>$1</code></pre>');

// Convert bold & italics
md = md.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
md = md.replace(/\*(.*?)\*/g, '<em>$1</em>');

// Convert lists
md = md.replace(/^\- (.*$)/gim, '<li style="margin-bottom: 4px; font-size: 12px; line-height: 1.5;">$1</li>');

const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>RISpro Scheduling Engine & Policy Manager - Benghazi Medical Center</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 0;
      line-height: 1.6;
    }
    p { font-size: 12px; margin: 8px 0; }
    li { font-size: 12px; }
    @page {
      margin: 15mm;
      @bottom-right {
        content: counter(page);
      }
    }
  </style>
</head>
<body>
  ${md}
</body>
</html>`;

const tempHtml = path.resolve("docs/bmc-product-guide/temp_pdf_render.html");
fs.writeFileSync(tempHtml, htmlContent, "utf8");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
await page.goto(pathToFileURL(tempHtml).href, { waitUntil: "load" });
await page.pdf({
  path: pdfOutputPath,
  format: "A4",
  printBackground: true,
  margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
});
await browser.close();

fs.unlinkSync(tempHtml);
console.log("PDF exported successfully:", pdfOutputPath, "(size:", fs.statSync(pdfOutputPath).size, "bytes)");
