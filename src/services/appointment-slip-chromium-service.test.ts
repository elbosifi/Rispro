import assert from "node:assert/strict";
import test from "node:test";
import { AppointmentSlipRenderError, renderAppointmentSlipPdf } from "./appointment-slip-chromium-service.js";
import { renderChromiumPdf } from "./chromium-pdf-service.js";

test("Chromium appointment-slip renderer waits for the final document marker and resources before producing a PDF", async () => {
  const calls: string[] = [];
  const page = {
    setDefaultTimeout(value: number) { calls.push(`timeout:${value}`); },
    async goto(url: string, options: Record<string, unknown>) { calls.push(`goto:${url}:${options.waitUntil}`); },
    async waitForSelector(selector: string) { calls.push(`ready:${selector}`); },
    async evaluate() { calls.push("fonts"); },
    async pdf(options: Record<string, unknown>) { calls.push(`pdf:${JSON.stringify(options)}`); return Buffer.from("%PDF-1.7"); },
    async close() { calls.push("page-close"); },
  };
  const launch = async (options: Record<string, unknown>) => {
    calls.push(`launch:${JSON.stringify(options.args)}`);
    return { newPage: async () => page, close: async () => { calls.push("close"); } } as never;
  };

  const pdf = await renderAppointmentSlipPdf("http://127.0.0.1:3000/print/internal/appointment-slip?token=redacted", launch as never);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.deepEqual(calls.slice(1, 5), [
    "timeout:45000",
    "goto:http://127.0.0.1:3000/print/internal/appointment-slip?token=redacted:domcontentloaded",
    'ready:[data-appointment-slip-document="true"]',
    "fonts",
  ]);
  assert.match(calls.find((value) => value.startsWith("pdf:")) || "", /"printBackground":true/);
  assert.match(calls.find((value) => value.startsWith("pdf:")) || "", /"preferCSSPageSize":true/);
  assert.deepEqual(calls.slice(-2), ["page-close", "close"]);
});

test("Chromium renderer closes the browser and returns a typed failure", async () => {
  let closed = false;
  const launch = async () => ({
    newPage: async () => ({ setDefaultTimeout() {}, async goto() { throw new Error("navigation failed"); }, async close() {} }),
    close: async () => { closed = true; },
  }) as never;
  await assert.rejects(() => renderAppointmentSlipPdf("http://127.0.0.1:3000/print/internal/appointment-slip?token=redacted", launch as never), AppointmentSlipRenderError);
  assert.equal(closed, true);
});

test("shared Chromium renderer accepts trusted HTML and waits for fonts before PDF", async () => {
  const calls: string[] = [];
  const page = { setDefaultTimeout() {}, async setContent(html: string) { calls.push(`html:${html}`); }, async evaluate() { calls.push("fonts"); }, async pdf() { calls.push("pdf"); return Buffer.from("%PDF-1.7"); }, async close() { calls.push("page-close"); } };
  const launch = async () => ({ newPage: async () => page, close: async () => { calls.push("browser-close"); } }) as never;
  const pdf = await renderChromiumPdf({ source: { kind: "html", html: "<p>trusted</p>" }, documentKind: "test" }, launch as never);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.deepEqual(calls, ["html:<p>trusted</p>", "fonts", "pdf", "page-close", "browser-close"]);
});
