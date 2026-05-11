import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildDicomUploadSelectionPlan,
  DICOM_PREVIEW_HEADER_BYTES,
  isSkippableDicomSidecarFile,
  previewDicomStudiesFromFiles,
  scanDicomStudiesFromFiles,
  type DicomStudyScanResult,
} from "./dicom-study-scan";

vi.mock("dicom-parser", () => ({
  parseDicom: vi.fn(),
}));

import * as dicomParser from "dicom-parser";

function mockDataSet(tags: Record<string, string>) {
  return {
    string: (tag: string) => tags[tag],
  };
}

function makeFile(name: string, size = 2048, type = "application/octet-stream") {
  const bytes = new Uint8Array(size).fill(1);
  return new File([bytes], name, { type });
}

describe("dicom study scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips sidecar files before parsing", async () => {
    const parseMock = vi.mocked(dicomParser.parseDicom);
    parseMock.mockReturnValue(mockDataSet({
      x0020000d: "1.2.3",
    }) as never);

    const result = await scanDicomStudiesFromFiles([
      makeFile("AUTORUN.INF"),
      makeFile("DICOMDIR"),
      makeFile("img-1.dcm", 1024, "application/dicom"),
    ]);

    expect(result.skippedSidecarCount).toBe(2);
    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(result.studies).toHaveLength(1);
  });

  it("groups files by StudyInstanceUID", async () => {
    const parseMock = vi.mocked(dicomParser.parseDicom);
    parseMock
      .mockReturnValueOnce(mockDataSet({
        x0020000d: "1.2.3.a",
        x0020000e: "series-a1",
        x00080060: "CT",
      }) as never)
      .mockReturnValueOnce(mockDataSet({
        x0020000d: "1.2.3.a",
        x0020000e: "series-a2",
        x00080060: "CT",
      }) as never)
      .mockReturnValueOnce(mockDataSet({
        x0020000d: "1.2.3.b",
        x0020000e: "series-b1",
        x00080060: "MR",
      }) as never);

    const result = await scanDicomStudiesFromFiles([
      makeFile("a1.dcm"),
      makeFile("a2.dcm"),
      makeFile("b1.dcm"),
    ]);

    expect(result.studies).toHaveLength(2);
    const studyA = result.studies.find((study) => study.studyInstanceUid === "1.2.3.a");
    const studyB = result.studies.find((study) => study.studyInstanceUid === "1.2.3.b");
    expect(studyA?.fileCount).toBe(2);
    expect(studyA?.seriesCount).toBe(2);
    expect(studyB?.fileCount).toBe(1);
  });

  it("puts files with missing StudyInstanceUID into unparsed bucket", async () => {
    const parseMock = vi.mocked(dicomParser.parseDicom);
    parseMock.mockReturnValue(mockDataSet({
      x0020000e: "series-a1",
    }) as never);

    const result = await scanDicomStudiesFromFiles([makeFile("missing-uid.dcm")]);
    expect(result.studies).toHaveLength(0);
    expect(result.unparsedCount).toBe(1);
    expect(result.unparsedFiles[0]?.fileName).toBe("missing-uid.dcm");
  });

  it("builds upload plan using selected study only", () => {
    const fileA = makeFile("a.dcm");
    const fileB = makeFile("b.dcm");
    const scanResult: DicomStudyScanResult = {
      studies: [
        {
          studyInstanceUid: "1.2.3.a",
          studyDate: "",
          studyDescription: "",
          modality: "",
          patientId: "",
          patientName: "",
          seriesCount: 1,
          fileCount: 1,
          totalBytes: fileA.size,
          files: [{
            file: fileA,
            fileName: fileA.name,
            filePath: fileA.name,
            fileSize: fileA.size,
            studyInstanceUid: "1.2.3.a",
            seriesInstanceUid: "",
            sopInstanceUid: "",
            studyDate: "",
            studyDescription: "",
            modality: "",
            patientId: "",
            patientName: "",
          }],
        },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 1,
      totalFileCount: 2,
      dicomLikeFileCount: 2,
      parsedDicomFileCount: 1,
      fallbackUploadFiles: [fileA, fileB],
      unparsedFiles: [{
        file: fileB,
        fileName: fileB.name,
        filePath: fileB.name,
        fileSize: fileB.size,
        reason: "missing_or_unreadable_study_uid",
      }],
    };

    const selectedPlan = buildDicomUploadSelectionPlan(scanResult, "1.2.3.a", false);
    expect(selectedPlan.usesFallback).toBe(false);
    expect(selectedPlan.files).toHaveLength(1);
    expect(selectedPlan.selectedStudyInstanceUid).toBe("1.2.3.a");

    const fallbackPlan = buildDicomUploadSelectionPlan(scanResult, "", true);
    expect(fallbackPlan.usesFallback).toBe(true);
    expect(fallbackPlan.files).toHaveLength(2);
  });

  it("marks backend sidecar patterns as skippable", () => {
    expect(isSkippableDicomSidecarFile("AUTORUN.INF")).toBe(true);
    expect(isSkippableDicomSidecarFile("DICOMDIR")).toBe(true);
    expect(isSkippableDicomSidecarFile("MEDIAVIE.PRO")).toBe(true);
    expect(isSkippableDicomSidecarFile("viewer.exe")).toBe(true);
    expect(isSkippableDicomSidecarFile("CDVIEWER.JAR")).toBe(true);
    expect(isSkippableDicomSidecarFile("scan1.dcm")).toBe(false);
  });

  it("preview upload sends bounded header slices instead of full files", async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      const body = init?.body as FormData;
      const uploaded = body.getAll("files") as Blob[];
      expect(uploaded).toHaveLength(1);
      expect(uploaded[0]?.size).toBe(DICOM_PREVIEW_HEADER_BYTES);
      return {
        ok: true,
        json: async () => ({
          studies: [{
            studyInstanceUid: "1.2.3",
            studyDate: "",
            studyDescription: "",
            modality: "",
            patientId: "",
            patientName: "",
            seriesCount: 1,
            fileCount: 1,
            totalBytes: DICOM_PREVIEW_HEADER_BYTES + 100,
            files: [{ previewIndex: 0, fileName: "large.dcm" }],
          }],
          skippedSidecarCount: 0,
          unparsedCount: 0,
          fallbackUploadFiles: [],
          unparsedFiles: [],
          previewOnly: true,
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await previewDicomStudiesFromFiles([makeFile("large.dcm", DICOM_PREVIEW_HEADER_BYTES + 100)]);

    expect(fetchMock).toHaveBeenCalledWith("/api/pacs/remap/preview-multipart", expect.objectContaining({
      method: "POST",
      credentials: "include",
    }));
  });
});
