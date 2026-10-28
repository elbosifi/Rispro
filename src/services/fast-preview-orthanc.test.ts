import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";
const service = await import("./authoritative-orthanc-service.js");
const settings = { enabled: true, autoExportClinicalDocuments: false, autoRouteEnabled: false, autoRouteDestinationKey: "", autoRouteDestinationKeys: [] as string[], baseUrl: "http://orthanc.test", username: "", password: "", timeoutSeconds: 5, verifyTls: true, displayName: "" };
const study = { orthancStudyId: "study", studyInstanceUid: "1.2.3", accessionNumber: "ACC", patientId: "PATIENT", patientName: null, patientBirthDate: null, patientSex: null, studyDate: null, studyDescription: null, modalitiesInStudy: ["CT"], seriesCount: 1, instanceCount: 1 };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
afterEach(() => service.__resetAuthoritativeOrthancForTests());

function mock(tags: Record<string, unknown>, parent = "study") {
  let rendered: URL | null = null;
  service.__setAuthoritativeOrthancFetchForTests(async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/instances/image") return json({ ParentSeries: "series" });
    if (parsed.pathname === "/series/series") return json({ ParentStudy: parent });
    if (parsed.pathname === "/instances/image/simplified-tags") return json(tags);
    if (parsed.pathname === "/instances/image/frames/0/rendered") { rendered = parsed; assert.equal(new Headers(init?.headers).get("accept"), "image/jpeg"); return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "Content-Type": "image/jpeg" } }); }
    throw new Error(`Unexpected ${parsed.pathname}`);
  });
  return () => rendered;
}
const tags = { StudyInstanceUID: "1.2.3", PatientID: "PATIENT", AccessionNumber: "ACC", Modality: "CT", SOPClassUID: "1.2.840.10008.5.1.4.1.1.2", Rows: "256", Columns: "384", PhotometricInterpretation: "MONOCHROME2", NumberOfFrames: "1", SamplesPerPixel: "1" };

test("requests JPEG, caps width at source size, and forwards server-side window and quality", async () => {
  const rendered = mock(tags);
  const result = await new service.AuthoritativeOrthancClient(settings).previewImage(study, "image", 75, 512, { center: -600, width: 1500 });
  assert.deepEqual([...result], [255, 216, 255, 217]);
  const query = rendered()!.searchParams;
  assert.equal(query.get("width"), "384"); assert.equal(query.get("quality"), "75");
  assert.equal(query.get("window-center"), "-600"); assert.equal(query.get("window-width"), "1500");
});

test("rejects unrelated studies, mismatched patient identities, and multiframe images before rendering", async () => {
  for (const [modified, parent] of [[tags, "other"], [{ ...tags, PatientID: "OTHER" }, "study"], [{ ...tags, NumberOfFrames: "2" }, "study"]] as const) {
    const rendered = mock(modified, parent);
    await assert.rejects(() => new service.AuthoritativeOrthancClient(settings).previewImage(study, "image", 75, 512, null));
    assert.equal(rendered(), null);
  }
});
