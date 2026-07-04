import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePath = `${process.cwd()}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`;
const repoPath = `${process.cwd()}/src/modules/appointments-v2/booking/repositories/booking.repo.ts`;

test("V2 print details payload includes exam preparation fields", async () => {
  const [routeSource, repoSource] = await Promise.all([
    readFile(routePath, "utf-8"),
    readFile(repoPath, "utf-8"),
  ]);

  assert.ok(
    routeSource.includes("specific_instruction_ar as exam_specific_instruction_ar") &&
      routeSource.includes("specific_instruction_en as exam_specific_instruction_en"),
    "V2 read route should select exam preparation fields"
  );
  assert.ok(
    repoSource.includes("specific_instruction_ar as exam_specific_instruction_ar") &&
      repoSource.includes("specific_instruction_en as exam_specific_instruction_en"),
    "Booking print details repository should select exam preparation fields"
  );
});
