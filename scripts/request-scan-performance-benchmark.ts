import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { extractRequestScanBarcode } from "../src/services/request-scan-barcode-service.js";

const measuredRuns = 3;
const root = process.env.REQUEST_SCAN_BENCHMARK_DIR
  ? path.resolve(process.env.REQUEST_SCAN_BENCHMARK_DIR)
  : await fs.mkdtemp(path.join(os.tmpdir(), "rispro-request-scan-benchmark-"));
const generated = !process.env.REQUEST_SCAN_BENCHMARK_DIR;
if (generated) await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "white" } }).jpeg({ quality: 92 }).toFile(path.join(root, "generated-clear-image.jpg"));
const files = (await fs.readdir(root)).filter((name) => /\.(pdf|jpe?g)$/i.test(name)).sort();
if (!files.length) throw new Error("REQUEST_SCAN_BENCHMARK_DIR contains no supported fixtures.");
const results = [];
try {
  for (const [index, name] of files.entries()) {
    const source = path.join(root, name);
    await extractRequestScanBarcode(source);
    const runs: Array<Record<string, string | number | boolean>> = [];
    for (let run = 0; run < measuredRuns; run += 1) {
      let metrics: Record<string, string | number | boolean> = {};
      await extractRequestScanBarcode(source, undefined, { onPerformanceMetrics(value) { metrics = value; } });
      runs.push(metrics);
    }
    const durations = runs.map((run) => Number(run.elapsedMs)).sort((a, b) => a - b);
    results.push({
      fixture: `fixture-${index + 1}-${crypto.createHash("sha256").update(name).digest("hex").slice(0, 8)}`,
      runs,
      medianMs: durations[Math.floor(durations.length / 2)],
      slowestMs: durations.at(-1),
    });
  }
  const report = { generatedFixtures: generated, measuredRuns, results };
  const output = path.resolve(process.env.REQUEST_SCAN_BENCHMARK_OUTPUT ?? path.join(os.tmpdir(), "request-scan-benchmark.json"));
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  if (generated) await fs.rm(root, { recursive: true, force: true });
}
