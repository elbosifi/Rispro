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
    const context: { window: { location: { search: string }; config?: Record<string, unknown> }; URLSearchParams: typeof URLSearchParams } = { window: { location: { search: "" } }, URLSearchParams };
    vm.runInNewContext(source, context);
    assert.equal(context.window.config?.showStudyList, false);
    assert.equal(context.window.config?.defaultDataSourceName, "risproDicomWeb");
  });
  it("keeps the DICOMweb selector separate in two viewer tabs", async () => {
    const source = await fs.readFile(appConfigPath,"utf8");
    const root = (id: string) => {
      const context = {window:{location:{search:`?risproContext=${id}`},config:{} as {dataSources?:{configuration:{qidoRoot:string}}[]}},URLSearchParams};
      vm.runInNewContext(source,context);
      return context.window.config.dataSources?.[0].configuration.qidoRoot;
    };
    assert.equal(root("00000000-0000-4000-8000-000000000001"),"/ohif-dicomweb/context/00000000-0000-4000-8000-000000000001");
    assert.notEqual(root("00000000-0000-4000-8000-000000000001"),root("00000000-0000-4000-8000-000000000002"));
  });
  it("lists explicit primary/prior selectors without adding them to eager study loading", async () => {
    const source=await fs.readFile(appConfigPath,"utf8");
    const context={window:{location:{search:'?StudyInstanceUIDs=1.2.3&risproPriorStudyUIDs=1.2.4,1.2.3,invalid'},config:{} as {dataSources?:{configuration:{risproStudyInstanceUIDs:string[]}}[]}},URLSearchParams};
    vm.runInNewContext(source,context);
    assert.deepEqual(Array.from(context.window.config.dataSources![0].configuration.risproStudyInstanceUIDs),['1.2.3','1.2.4']);
  });
});
