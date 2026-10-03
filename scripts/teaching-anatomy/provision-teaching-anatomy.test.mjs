import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ensureOpenAnatomyAtlas, ensureTeachingAnatomyAtlases } from "./provision-teaching-anatomy.mjs";

test("atlas provisioning isolates failed optional sources and reports a partial catalog", async () => {
  const lines = [];
  const results = await ensureTeachingAnatomyAtlases({
    assetRoot: "/unused/test-assets",
    ensureLiver: async () => ({ status: "ready", atlasId: "spl-liver" }),
    fetchImpl: async () => { throw new Error("synthetic offline source"); },
    log: (line) => lines.push(line),
  });

  assert.deepEqual(results.map(({ atlasId, status }) => [atlasId, status]), [
    ["spl-liver", "ready"],
    ["spl-abdomen", "unavailable"],
    ["spl-head-neck", "unavailable"],
    ["spl-knee", "unavailable"],
    ["bodyparts3d", "unavailable"],
  ]);
  assert.ok(lines.includes("RISPRO_TEACHING_ANATOMY_STATUS=partial"));
  assert.ok(lines.includes("RISPRO_TEACHING_ANATOMY_ATLAS_SPL_LIVER=ready"));
  assert.ok(lines.includes("RISPRO_TEACHING_ANATOMY_ATLAS_BODYPARTS3D=unavailable"));
});

test("pinned source redirects cannot leave the allow-listed HTTPS hosts", async () => {
  let requests = 0;
  const result = await ensureOpenAnatomyAtlas({
    atlasId: "spl-abdomen",
    assetRoot: "/unused/test-assets",
    fetchImpl: async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { location: "https://attacker.invalid/archive.zip" } });
    },
  });

  assert.equal(requests, 1);
  assert.equal(result.status, "unavailable");
  assert.match(result.error, /untrusted URL/i);
});

test("installed SPL notices include the full Slicer Part B terms and non-clinical restriction", async () => {
  const terms = await readFile(new URL("./slicer-license-part-b.txt", import.meta.url), "utf8");
  assert.match(terms, /royalty-free, non-exclusive license/i);
  assert.match(terms, /incorporate the Software into proprietary programs/i);
  assert.match(terms, /CLINICAL APPLICATIONS ARE NEITHER RECOMMENDED NOR ADVISED/);
  assert.match(terms, /preserve and maintain all applicable attributions/i);
  assert.match(terms, /https:\/\/www\.openanatomy\.org\/atlas-pages\/slicer-license\.html/);
});
