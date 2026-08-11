import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  applyCatalogWorkbookImport,
  createModality,
  deactivateModality,
  deleteModality,
  deleteNameDictionaryEntry,
  deletePatientNotAllowedNameWord,
  fetchExamTypes,
  fetchModalitiesSettings,
  fetchNameDictionary,
  fetchPatientNotAllowedNameWords,
  previewCatalogWorkbookImport,
  updateModality,
  upsertNameDictionaryEntry,
  upsertPatientNotAllowedNameWord,
} from "./catalog";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));

describe("settings catalog API contracts", () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it("preserves catalog lookup and modality mutation routes", async () => {
    vi.mocked(api).mockResolvedValue({ modalities: [], examTypes: [], entries: [], meta: {}, modality: {} });

    await fetchExamTypes(true);
    await fetchModalitiesSettings(true);
    await createModality({ code: "CT" });
    await updateModality(4, { code: "MR" });
    await deactivateModality(4);
    await deleteModality(4);

    expect(api).toHaveBeenNthCalledWith(1, "/settings/exam-types?includeInactive=true");
    expect(api).toHaveBeenNthCalledWith(2, "/settings/modalities?includeInactive=true");
    expect(api).toHaveBeenNthCalledWith(3, "/settings/modalities", { method: "POST", body: JSON.stringify({ code: "CT" }) });
    expect(api).toHaveBeenNthCalledWith(4, "/settings/modalities/4", { method: "PUT", body: JSON.stringify({ code: "MR" }) });
    expect(api).toHaveBeenNthCalledWith(5, "/settings/modalities/4/deactivate", { method: "POST" });
    expect(api).toHaveBeenNthCalledWith(6, "/settings/modalities/4", { method: "DELETE" });
  });

  it("preserves dictionary and patient-name-rule routes", async () => {
    vi.mocked(api).mockResolvedValue({ entries: [], meta: {}, entry: {} });

    await fetchNameDictionary();
    await upsertNameDictionaryEntry("محمد", "Mohamed");
    await deleteNameDictionaryEntry(3);
    await fetchPatientNotAllowedNameWords();
    await upsertPatientNotAllowedNameWord("test");
    await deletePatientNotAllowedNameWord(5);

    expect(api).toHaveBeenNthCalledWith(1, "/settings/name-dictionary");
    expect(api).toHaveBeenNthCalledWith(2, "/settings/name-dictionary", { method: "POST", body: JSON.stringify({ arabicText: "محمد", englishText: "Mohamed" }) });
    expect(api).toHaveBeenNthCalledWith(3, "/settings/name-dictionary/3", { method: "DELETE" });
    expect(api).toHaveBeenNthCalledWith(4, "/settings/not-allowed-name-words");
    expect(api).toHaveBeenNthCalledWith(5, "/settings/not-allowed-name-words", { method: "POST", body: JSON.stringify({ arabicText: "test" }) });
    expect(api).toHaveBeenNthCalledWith(6, "/settings/not-allowed-name-words/5", { method: "DELETE" });
  });

  it("preserves catalog preview/apply payloads and 180-second timeout", async () => {
    vi.mocked(api).mockResolvedValue({ preview: {}, summary: {} });

    await previewCatalogWorkbookImport({ fileContentBase64: "base64" });
    await applyCatalogWorkbookImport({ modalities: [{ id: 1 }], examTypes: [{ id: 2 }] });

    expect(api).toHaveBeenNthCalledWith(1, "/settings/catalog-import-export/preview", {
      method: "POST",
      body: JSON.stringify({ fileContentBase64: "base64" }),
    }, 180_000);
    expect(api).toHaveBeenNthCalledWith(2, "/settings/catalog-import-export/apply", {
      method: "POST",
      body: JSON.stringify({ modalities: [{ id: 1 }], examTypes: [{ id: 2 }] }),
    }, 180_000);
  });
});
