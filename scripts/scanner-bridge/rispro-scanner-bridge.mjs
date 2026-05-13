#!/usr/bin/env node
import http from "node:http";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.RISPRO_SCANNER_BRIDGE_PORT || "9810", 10);
const NAPS2_BASE_URL = (process.env.NAPS2_ESCL_BASE_URL || "http://127.0.0.1:9801").replace(/\/+$/, "");
const ALLOWED_ORIGINS = new Set(
  (process.env.RISPRO_ALLOWED_ORIGINS || process.env.RISPRO_ORIGIN || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function setCorsHeaders(req, res) {
  const origin = String(req.headers.origin || "");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function isOriginAllowed(req) {
  const origin = String(req.headers.origin || "");
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function sendJson(res, statusCode, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": bytes.length,
  });
  res.end(bytes);
}

function normalizeScanOptions(input) {
  const body = input && typeof input === "object" ? input : {};
  const dpi = Number.parseInt(String(body.dpi || "200"), 10);
  const colorMode = body.colorMode === "color" ? "color" : "grayscale";
  const source = body.source === "flatbed" || body.source === "duplex" ? body.source : "feeder";
  return {
    dpi: Number.isInteger(dpi) && dpi > 0 ? dpi : 200,
    colorMode,
    source,
  };
}

function toEsclInputSource(source) {
  if (source === "flatbed") return "Platen";
  return "Feeder";
}

function toEsclColorMode(colorMode) {
  return colorMode === "color" ? "RGB24" : "Grayscale8";
}

function buildScanSettings(options, documentFormat) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm" xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03">
  <pwg:Version>2.6</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <scan:InputSource>${toEsclInputSource(options.source)}</scan:InputSource>
  <pwg:DocumentFormat>${documentFormat}</pwg:DocumentFormat>
  <scan:DocumentFormatExt>${documentFormat}</scan:DocumentFormatExt>
  <scan:XResolution>${options.dpi}</scan:XResolution>
  <scan:YResolution>${options.dpi}</scan:YResolution>
  <scan:ColorMode>${toEsclColorMode(options.colorMode)}</scan:ColorMode>
</scan:ScanSettings>`;
}

async function createScanJob(options, documentFormat) {
  const response = await fetch(`${NAPS2_BASE_URL}/eSCL/ScanJobs`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: buildScanSettings(options, documentFormat),
  });
  if (!response.ok) {
    throw new Error(`Scan job creation failed with HTTP ${response.status} for ${documentFormat}.`);
  }
  const location = response.headers.get("Location") || "";
  const jobId = location.trim().replace(/\/+$/, "").split("/").pop();
  if (!jobId) throw new Error("NAPS2 did not return a scan job id.");
  return jobId;
}

async function readScannedPages(jobId) {
  const pages = [];
  for (let page = 0; page < 100; page += 1) {
    const response = await fetch(`${NAPS2_BASE_URL}/eSCL/ScanJobs/${encodeURIComponent(jobId)}/NextDocument`);
    if (response.status === 404) break;
    if (!response.ok) throw new Error(`NAPS2 page read failed with HTTP ${response.status}.`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 0) {
      pages.push({
        contentType: response.headers.get("Content-Type") || "image/jpeg",
        buffer,
      });
    }
  }
  return pages;
}

function readJpegInfo(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const length = (buffer[offset + 2] << 8) + buffer[offset + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (buffer[offset + 5] << 8) + buffer[offset + 6],
        width: (buffer[offset + 7] << 8) + buffer[offset + 8],
        colorSpace: buffer[offset + 9] === 1 ? "/DeviceGray" : "/DeviceRGB",
      };
    }
    offset += 2 + length;
  }
  return { width: 612, height: 792, colorSpace: "/DeviceRGB" };
}

function buildPdfFromJpegPages(pages) {
  const chunks = [];
  const offsets = [];
  let byteLength = 0;
  let nextObjectId = 3;

  function appendText(text) {
    const bytes = Buffer.from(text, "utf8");
    chunks.push(bytes);
    byteLength += bytes.length;
  }

  function appendBuffer(buffer) {
    chunks.push(buffer);
    byteLength += buffer.length;
  }

  function beginObject(id) {
    offsets[id] = byteLength;
    appendText(`${id} 0 obj\n`);
  }

  appendText("%PDF-1.4\n");
  beginObject(1);
  appendText("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const pageInfos = pages.map((page) => {
    const pageObjectId = nextObjectId++;
    const imageObjectId = nextObjectId++;
    return { ...readJpegInfo(page.buffer), buffer: page.buffer, pageObjectId, imageObjectId };
  });

  beginObject(2);
  appendText(`<< /Type /Pages /Count ${pageInfos.length} /Kids [${pageInfos.map((page) => `${page.pageObjectId} 0 R`).join(" ")}] >>\nendobj\n`);

  for (const page of pageInfos) {
    beginObject(page.pageObjectId);
    appendText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Im${page.imageObjectId} ${page.imageObjectId} 0 R >> >> /Contents ${nextObjectId} 0 R >>\nendobj\n`);
    const contentObjectId = nextObjectId++;
    const content = `q\n${page.width} 0 0 ${page.height} 0 0 cm\n/Im${page.imageObjectId} Do\nQ\n`;
    beginObject(contentObjectId);
    appendText(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream\nendobj\n`);
    beginObject(page.imageObjectId);
    appendText(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace ${page.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.buffer.length} >>\nstream\n`);
    appendBuffer(page.buffer);
    appendText("\nendstream\nendobj\n");
  }

  const xrefOffset = byteLength;
  appendText(`xref\n0 ${nextObjectId}\n0000000000 65535 f \n`);
  for (let id = 1; id < nextObjectId; id += 1) {
    appendText(`${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`);
  }
  appendText(`trailer\n<< /Size ${nextObjectId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

async function scan(options) {
  let jobId;
  try {
    jobId = await createScanJob(options, "application/pdf");
  } catch {
    jobId = await createScanJob(options, "image/jpeg");
  }
  const pages = await readScannedPages(jobId);
  if (pages.length === 0) throw new Error("No scanned pages were returned by NAPS2.");
  if (pages.length === 1 && pages[0].contentType.toLowerCase().includes("pdf")) {
    return { contentType: "application/pdf", buffer: pages[0].buffer, pageCount: 1 };
  }
  return { contentType: "application/pdf", buffer: buildPdfFromJpegPages(pages), pageCount: pages.length };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function handle(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(isOriginAllowed(req) ? 204 : 403);
    res.end();
    return;
  }

  if (!isOriginAllowed(req)) {
    sendJson(res, 403, { ok: false, error: "Origin is not allowed." });
    return;
  }

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "rispro-scanner-bridge", naps2BaseUrl: NAPS2_BASE_URL });
      return;
    }

    if (req.method === "GET" && url.pathname === "/capabilities") {
      const response = await fetch(`${NAPS2_BASE_URL}/eSCL/ScannerCapabilities`);
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, {
        "Content-Type": response.headers.get("Content-Type") || "application/xml; charset=utf-8",
        "Content-Length": body.length,
      });
      res.end(body);
      return;
    }

    if (req.method === "POST" && url.pathname === "/scan") {
      const body = await readJsonBody(req);
      const result = await scan(normalizeScanOptions(body));
      res.writeHead(200, {
        "Content-Type": result.contentType,
        "Content-Length": result.buffer.length,
        "X-RISpro-Page-Count": String(result.pageCount),
      });
      res.end(result.buffer);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found." });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Scanner bridge error." });
  }
}

const server = http.createServer((req, res) => {
  void handle(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`RISpro scanner bridge listening on http://${HOST}:${PORT}`);
  console.log(`Proxying NAPS2 ESCL at ${NAPS2_BASE_URL}`);
  console.log(`Allowed origins: ${Array.from(ALLOWED_ORIGINS).join(", ") || "(none)"}`);
});
