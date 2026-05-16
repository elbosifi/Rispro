import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";

const source = await fs.readFile(new URL("./protocol-repository.ts", import.meta.url), "utf8");

test("assigned protocol changes use Sante replacement sync path", () => {
  assert.match(source, /scheduleBookingWorklistDetailReplacement/);
  assert.match(source, /protocol\.protocolStatus === "assigned"/);
  assert.match(source, /existing\.protocolStatus === "assigned" \|\| updated\.protocolStatus === "assigned"/);
});
