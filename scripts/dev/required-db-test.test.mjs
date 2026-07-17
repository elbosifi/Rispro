import assert from "node:assert/strict";
import test from "node:test";
import { parseRequiredDbArgs } from "./required-db-test.mjs";

test("db:test:required requires one or more file paths and rejects options", () => {
  assert.throws(() => parseRequiredDbArgs([]), /at least one DB test file/);
  assert.deepEqual(parseRequiredDbArgs(["src/example.integration.test.ts", "src/another.integration.test.ts"]), ["src/example.integration.test.ts", "src/another.integration.test.ts"]);
  assert.throws(() => parseRequiredDbArgs(["--wait", "src/example.integration.test.ts"]), /file paths only/);
});
