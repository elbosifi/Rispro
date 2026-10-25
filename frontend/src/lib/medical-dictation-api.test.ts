import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api-client";
import { transcribeDictation } from "./medical-dictation-api";

vi.mock("./api-client", () => ({ api: vi.fn(async () => ({ text: "normal", processing_seconds: 1 })) }));
afterEach(() => vi.clearAllMocks());
it.each([
  ["audio/webm;codecs=opus", "webm"], ["audio/mp4", "m4a"], ["audio/ogg;codecs=opus", "ogg"], ["audio/wav", "wav"],
])("passes the actual recorded format %s and matching filename to the existing API", async (type, extension) => {
  const recording = new Blob(["synthetic audio"], { type });
  const signal = new AbortController().signal;
  await transcribeDictation(recording, signal);
  const [path, options, timeout] = vi.mocked(api).mock.calls[0];
  expect(path).toBe("/medical-dictation/transcribe"); expect(timeout).toBe(630_000);
  expect(options?.signal).toBe(signal);
  const file = (options?.body as FormData).get("file") as File;
  expect(file.name).toBe(`dictation.${extension}`); expect(file.type).toBe(type); expect(file.size).toBe(recording.size);
});
