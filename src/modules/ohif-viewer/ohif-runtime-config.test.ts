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
    assert.equal((context.window.config?.investigationalUseDialog as { option: string }).option, "never");
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
  it("uses native delivery only for WADO when selected and retains scoped proxy discovery and rollback", async () => {
    const source = await fs.readFile(appConfigPath, "utf8");
    const contextId = "00000000-0000-4000-8000-000000000001";
    for (const [selector, native] of [["", false], ["&risproDelivery=native", true], ["&risproDelivery=proxy", false]] as const) {
      const context = { window: { location: { search: `?risproContext=${contextId}${selector}` }, config: {} as { maxNumRequests: { thumbnail: number }; dataSources: { configuration: { qidoRoot: string; wadoRoot: string; imageRendering: string } }[] } }, URLSearchParams };
      vm.runInNewContext(source, context);
      const config = context.window.config.dataSources[0].configuration;
      assert.equal(config.qidoRoot, `/ohif-dicomweb/context/${contextId}`);
      assert.equal(config.wadoRoot, `${native ? "/ohif-native" : "/ohif-dicomweb"}/context/${contextId}`);
      assert.equal(config.imageRendering, "wadors");
      assert.equal(context.window.config.maxNumRequests.thumbnail, native ? 4 : 1);
    }
  });
  it("selects upstream limits only for an explicit native experiment and isolates thumbnail scheduling", async () => {
    const source = await fs.readFile(appConfigPath, "utf8");
    const id = "00000000-0000-4000-8000-000000000001";
    for (const [query, limits] of [
      [`risproContext=${id}&risproDelivery=native`, [4, 4, 1]],
      [`risproContext=${id}&risproDelivery=native&risproLoadingProfile=current`, [4, 4, 1]],
      [`risproContext=${id}&risproDelivery=native&risproLoadingProfile=unknown`, [4, 4, 1]],
      [`risproContext=${id}&risproDelivery=native&risproLoadingProfile=upstream`, [100, 75, 25]],
      [`risproContext=${id}&risproDelivery=native&risproLoadingProfile=upstream&risproThumbnailProfile=current`, [100, 4, 25]],
      [`risproContext=${id}&risproDelivery=proxy&risproLoadingProfile=upstream`, [4, 1, 1]],
      ["risproContext=invalid&risproDelivery=native&risproLoadingProfile=upstream", [4, 1, 1]],
    ] as const) {
      const context = { window: { location: { search: `?${query}` }, config: {} as {
        maxNumRequests: { interaction: number; thumbnail: number; prefetch: number };
        dataSources: { configuration: { thumbnailRendering: string; enableStudyLazyLoad: boolean } }[];
      } }, URLSearchParams };
      vm.runInNewContext(source, context);
      const { interaction, thumbnail, prefetch } = context.window.config.maxNumRequests;
      assert.deepEqual([interaction, thumbnail, prefetch], limits);
      assert.equal(context.window.config.dataSources[0].configuration.enableStudyLazyLoad, true);
      assert.equal(context.window.config.dataSources[0].configuration.thumbnailRendering, thumbnail === 1 ? "wadors" : "rendered");
    }
  });
});
