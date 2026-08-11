import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isDirectExecution, parseCiInspectArgs } from "./ci-inspect.mjs";

test("ci:inspect parses exact-SHA refs and bounded waits without invoking GitHub", () => {
  assert.deepEqual(parseCiInspectArgs(["--sha", "HEAD", "--wait", "15"]), { ref: "HEAD", waitSeconds: 15, help: false });
  assert.deepEqual(parseCiInspectArgs(["--wait"]), { ref: "HEAD", waitSeconds: 300, help: false });
  assert.throws(() => parseCiInspectArgs(["--wait", "901"]), /between 1 and 900/);
  assert.throws(() => parseCiInspectArgs(["--sha"]), /requires a commit SHA/);
});

test("ci:inspect recognizes its entry point using platform-native paths", () => {
  const moduleUrl = new URL("./ci-inspect.mjs", import.meta.url);

  assert.equal(isDirectExecution(moduleUrl.href, fileURLToPath(moduleUrl)), true);
  assert.equal(isDirectExecution(moduleUrl.href, fileURLToPath(import.meta.url)), false);
  assert.equal(isDirectExecution(moduleUrl.href, undefined), false);
});
