import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  __registrationListRenderContextTestables,
  contextFromRegistrationListRenderToken,
  createRegistrationListRenderContext,
  deleteRegistrationListRenderContext,
  issueRegistrationListRenderToken,
  MAX_REGISTRATION_LIST_IDS,
  assertCompleteRegistrationListRows,
} from "./registration-list-render-context-service.js";

afterEach(() => __registrationListRenderContextTestables.contexts.clear());

describe("registration-list render contexts", () => {
  it("preserves unique submitted IDs and remains readable until the outer owner deletes it", () => {
    const context = createRegistrationListRenderContext([9, 2, 7], "Current filters");
    const token = issueRegistrationListRenderToken(context.id);
    assert.deepEqual(contextFromRegistrationListRenderToken(token).appointmentIds, [9, 2, 7]);
    assert.deepEqual(contextFromRegistrationListRenderToken(token).appointmentIds, [9, 2, 7]);
    deleteRegistrationListRenderContext(context.id);
    assert.throws(() => contextFromRegistrationListRenderToken(token), /invalid or expired/);
  });

  it("rejects duplicate, invalid, empty, and oversized ID collections", () => {
    assert.throws(() => createRegistrationListRenderContext([], "x"));
    assert.throws(() => createRegistrationListRenderContext([1, 1], "x"));
    assert.throws(() => createRegistrationListRenderContext([0], "x"));
    assert.throws(() => createRegistrationListRenderContext(Array.from({ length: MAX_REGISTRATION_LIST_IDS + 1 }, (_, index) => index + 1), "x"));
  });

  it("lazily removes expired contexts", () => {
    const context = createRegistrationListRenderContext([1], "x");
    context.expiresAt = Date.now() - 1;
    __registrationListRenderContextTestables.removeExpired();
    assert.equal(__registrationListRenderContextTestables.contexts.size, 0);
  });

  it("requires every row in exact submitted order and rejects partial or substituted results", () => {
    const context = createRegistrationListRenderContext([9, 2, 7], "x");
    assert.deepEqual(assertCompleteRegistrationListRows(context, [{ id: 9 }, { id: 2 }, { id: 7 }]), [{ id: 9 }, { id: 2 }, { id: 7 }]);
    assert.throws(() => assertCompleteRegistrationListRows(context, [{ id: 9 }, { id: 7 }] as Array<{ id: unknown }>), /could not be resolved/);
    assert.throws(() => assertCompleteRegistrationListRows(context, [{ id: 9 }, { id: 7 }, { id: 2 }]), /could not be resolved/);
  });
});
