import { resetTeachingContent, TEACHING_RESET_CONFIRMATION } from "../../src/modules/teaching/services/teaching-reset-service.js";

const args = process.argv.slice(2); const confirmIndex = args.indexOf("--confirm"); const confirmation = confirmIndex >= 0 ? args[confirmIndex + 1] : undefined;
const result = await resetTeachingContent({ confirmation });
if (!result.deleted) {
  console.log("Teaching content reset dry run. No data was deleted.");
  console.log(JSON.stringify(result.counts, null, 2));
  console.log(`To reset non-production Teaching content, run: ${result.confirmationCommand}`);
} else {
  console.log(`Teaching content reset complete using ${TEACHING_RESET_CONFIRMATION}.`, JSON.stringify(result.counts));
  console.log("Teaching asset files deleted: " + result.assetFilesDeleted);
  if (result.assetFileDeletionFailures.length) {
    console.error("Teaching content data was deleted, but these Teaching asset files need attention:");
    console.error(JSON.stringify(result.assetFileDeletionFailures, null, 2));
  }
}
