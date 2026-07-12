import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const appConfigPath = path.resolve(currentDir, "../../../docker/ohif/app-config.js");

describe("OHIF runtime configuration", () => {
  it("disables generic PACS browsing while retaining the RISpro DICOMweb data source", async () => {
    const source = await fs.readFile(appConfigPath, "utf8");
    const context: { window: { config?: Record<string, unknown> } } = { window: {} };
    vm.runInNewContext(source, context);
    assert.equal(context.window.config?.showStudyList, false);
    assert.equal(context.window.config?.defaultDataSourceName, "risproDicomWeb");
  });
});
