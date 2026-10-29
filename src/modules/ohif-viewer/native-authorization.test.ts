import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret";
const { parseNativeDicomWebUri } = await import("./native-authorization.js");
const root = "/ohif-native/context/00000000-0000-4000-8000-000000000001";

describe("native DICOMweb complete raw path validation", () => {
  it("preserves study/series metadata, rendered thumbnails, multipart frame lists and query strings", () => {
    for (const path of ["/studies/1.2.3", "/studies/1.2.3/metadata", "/studies/1.2.3/series", "/studies/1.2.3/series/1.2.4/metadata", "/studies/1.2.3/series/1.2.4/instances", "/studies/1.2.3/series/1.2.4/instances/1.2.5/rendered?viewport=100,100", "/studies/1.2.3/series/1.2.4/instances/1.2.5/frames/1,2", "/studies/1.2.3/series/1.2.4/instances/1.2.5/frames/1/rendered"]) {
      assert.equal(parseNativeDicomWebUri(root + path).relativePathWithQuery, path);
    }
  });
  it("rejects admin endpoints, arbitrary suffixes, traversal, encoded separators and invalid UIDs", () => {
    for (const path of ["/system", "/studies", "/studies/1.2.3/../../system", "/studies/1.2.3/%2e%2e/system", "/studies/1.2.3/series/1%2f2", "/studies/1.2.3/series/..", "/studies/1.2.3/delete", "/studies/1.2.3/metadata/extra", "/studies/1.2.3/", "/studies/1.2.3//metadata", "/studies/1.2.3/frames/1", "/studies/" + "1.".repeat(33) + "1", "/studies/1.2.3/series/1.2.4/instances/1.2.5/frames/0"]) {
      assert.throws(() => parseNativeDicomWebUri(root + path), { statusCode: 403 }, path);
    }
  });
});
