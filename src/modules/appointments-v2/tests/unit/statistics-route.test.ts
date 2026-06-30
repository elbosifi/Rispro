import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync(new URL("../../api/routes/read-v2-routes.ts", import.meta.url), "utf8");

describe("statistics read route", () => {
  it("keeps statistics page access on the route", () => {
    assert.match(routeSource, /"\/statistics"[\s\S]*requirePageAccess\("statistics"\)/);
  });

  it("keeps date query compatibility and accepts bounded range filters", () => {
    assert.match(routeSource, /compatibilityDate = parseStatisticsIsoDateQuery\(query\.date\)/);
    assert.match(routeSource, /requestedDateFrom = parseStatisticsIsoDateQuery\(query\.dateFrom\)/);
    assert.match(routeSource, /requestedDateTo = parseStatisticsIsoDateQuery\(query\.dateTo\)/);
    assert.match(routeSource, /const dateFrom = compatibilityDate \|\| requestedDateFrom \|\| requestedDateTo \|\| getTripoliToday\(\)/);
    assert.match(routeSource, /const dateTo = compatibilityDate \|\| requestedDateTo \|\| requestedDateFrom \|\| dateFrom/);
    assert.match(routeSource, /b\.booking_date >= \$\$\{params\.length\}::date/);
    assert.match(routeSource, /b\.booking_date <= \$\$\{params\.length\}::date/);
  });

  it("defaults safely to Tripoli today when no date is supplied", () => {
    assert.match(routeSource, /requestedDateTo \|\| getTripoliToday\(\)/);
  });

  it("rejects invalid supplied date strings", () => {
    assert.match(routeSource, /function isValidIsoDate\(value: string\): boolean/);
    assert.match(routeSource, /date\.getUTCFullYear\(\) === year/);
    assert.match(routeSource, /compatibilityDate === "" \|\| requestedDateFrom === "" \|\| requestedDateTo === ""/);
    assert.match(routeSource, /res\.status\(400\)\.json\(\{ error: "date, dateFrom, and dateTo must be valid ISO dates \(YYYY-MM-DD\)\." \}\)/);
  });

  it("rejects reversed and excessive ranges without silently swapping", () => {
    assert.doesNotMatch(routeSource, /\[dateFrom, dateTo\] = \[dateTo, dateFrom\]/);
    assert.match(routeSource, /if \(dateFrom > dateTo\)/);
    assert.match(routeSource, /res\.status\(400\)\.json\(\{ error: "dateFrom must be on or before dateTo\." \}\)/);
    assert.match(routeSource, /isoDateDay\(dateTo\) - isoDateDay\(dateFrom\) \+ 1 > 366/);
    assert.match(routeSource, /res\.status\(400\)\.json\(\{ error: "Statistics date range must be 366 days or less\." \}\)/);
  });

  it("returns statistics response metadata", () => {
    assert.match(routeSource, /metadata:\s*\{/);
    assert.match(routeSource, /dateFrom,/);
    assert.match(routeSource, /dateTo,/);
    assert.match(routeSource, /modalityId:/);
    assert.match(routeSource, /generatedAt: new Date\(\)\.toISOString\(\)/);
  });

  it("orders statuses by workflow order", () => {
    const scheduledIndex = routeSource.indexOf("when 'scheduled' then 10");
    const arrivedIndex = routeSource.indexOf("when 'arrived' then 20");
    const waitingIndex = routeSource.indexOf("when 'waiting' then 30");
    const inProgressIndex = routeSource.indexOf("when 'in-progress' then 40");
    const completedIndex = routeSource.indexOf("when 'completed' then 50");
    const noShowIndex = routeSource.indexOf("when 'no-show' then 60");
    const cancelledIndex = routeSource.indexOf("when 'cancelled' then 70");
    const discontinuedIndex = routeSource.indexOf("when 'discontinued' then 80");
    const voidedIndex = routeSource.indexOf("when 'voided' then 90");

    assert.ok(scheduledIndex > 0);
    assert.ok(scheduledIndex < arrivedIndex);
    assert.ok(arrivedIndex < waitingIndex);
    assert.ok(waitingIndex < inProgressIndex);
    assert.ok(inProgressIndex < completedIndex);
    assert.ok(completedIndex < noShowIndex);
    assert.ok(noShowIndex < cancelledIndex);
    assert.ok(cancelledIndex < discontinuedIndex);
    assert.ok(discontinuedIndex < voidedIndex);
    assert.match(routeSource, /else 999/);
  });
});
