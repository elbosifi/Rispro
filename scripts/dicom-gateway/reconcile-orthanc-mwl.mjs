#!/usr/bin/env node
import "dotenv/config";
import { reconcileOrthancMwlProjection } from "../../src/services/orthanc-mwl-reconcile-service.js";

function parseArgs(argv) {
  const result = {
    dateFrom: "",
    dateTo: "",
    apply: false,
    limit: 5000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--date-from" && argv[i + 1]) {
      result.dateFrom = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--date-to" && argv[i + 1]) {
      result.dateTo = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    if (arg === "--limit" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0) {
        result.limit = parsed;
      }
      i += 1;
      continue;
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dateFrom || !args.dateTo) {
    console.error("Usage: node scripts/dicom-gateway/reconcile-orthanc-mwl.mjs --date-from YYYY-MM-DD --date-to YYYY-MM-DD [--apply] [--limit N]");
    process.exit(2);
  }

  const result = await reconcileOrthancMwlProjection({
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    apply: args.apply,
    limit: args.limit,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Orthanc MWL reconciliation failed.", error);
  process.exit(1);
});
