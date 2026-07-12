import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deleteOwnedOrthancCacheStudyIfEligible,
  determineOwnedOrthancCacheStudyId,
} from "./cache-ownership.js";

describe("OHIF Orthanc cache ownership", () => {
  it("deletes exactly one OHIF-owned cache resource that appeared after retrieval", async () => {
    const ownedId = determineOwnedOrthancCacheStudyId({ preexistingStudyIds: ["shared-study"], discoveredStudyIds: ["shared-study", "ohif-study"] });
    const deleted: string[] = [];
    const deletedOwned = await deleteOwnedOrthancCacheStudyIfEligible({
      cleanupEnabled: true, cacheOwnershipProven: ownedId === "ohif-study", ownedOrthancStudyId: ownedId,
      deleteExactStudy: async (id) => { deleted.push(id); },
    });
    assert.equal(deletedOwned, true);
    assert.deepEqual(deleted, ["ohif-study"]);
  });

  it("does not claim or delete a pre-existing Orthanc study", async () => {
    const ownedId = determineOwnedOrthancCacheStudyId({ preexistingStudyIds: ["already-present"], discoveredStudyIds: ["already-present"] });
    let deleteCalls = 0;
    const deleted = await deleteOwnedOrthancCacheStudyIfEligible({
      cleanupEnabled: true, cacheOwnershipProven: false, ownedOrthancStudyId: ownedId,
      deleteExactStudy: async () => { deleteCalls += 1; },
    });
    assert.equal(ownedId, null);
    assert.equal(deleted, false);
    assert.equal(deleteCalls, 0);
  });

  it("keeps shared or non-dedicated cache cleanup disabled without proven ownership", async () => {
    let deleteCalls = 0;
    const deleted = await deleteOwnedOrthancCacheStudyIfEligible({
      cleanupEnabled: false, cacheOwnershipProven: true, ownedOrthancStudyId: "candidate",
      deleteExactStudy: async () => { deleteCalls += 1; },
    });
    assert.equal(deleted, false);
    assert.equal(deleteCalls, 0);
  });

  it("does not delete when ownership metadata is missing", async () => {
    let deleteCalls = 0;
    const deleted = await deleteOwnedOrthancCacheStudyIfEligible({
      cleanupEnabled: true, cacheOwnershipProven: true, ownedOrthancStudyId: null,
      deleteExactStudy: async () => { deleteCalls += 1; },
    });
    assert.equal(deleted, false);
    assert.equal(deleteCalls, 0);
  });

  it("propagates a cache-delete failure without issuing another deletion", async () => {
    let deleteCalls = 0;
    await assert.rejects(() => deleteOwnedOrthancCacheStudyIfEligible({
      cleanupEnabled: true, cacheOwnershipProven: true, ownedOrthancStudyId: "ohif-study",
      deleteExactStudy: async () => { deleteCalls += 1; throw new Error("Orthanc unavailable"); },
    }), /Orthanc unavailable/);
    assert.equal(deleteCalls, 1);
  });
});
