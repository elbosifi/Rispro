import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { dictionaryReadOptions, retryDictionaryRead } from "./name-dictionary-query";

it("retries only transient reads, at most twice", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) expect(retryDictionaryRead(0, new ApiError("transient", status))).toBe(true);
  for (const status of [400, 401, 403, 404, 409]) expect(retryDictionaryRead(0, new ApiError("permanent", status))).toBe(false);
  expect(retryDictionaryRead(1, new TypeError("network"))).toBe(true);
  expect(retryDictionaryRead(2, new TypeError("network"))).toBe(false);
});

it("recovers automatically using the same query client, without restarting", async () => {
  const client = new QueryClient();
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue({ entries: ["restored"] });
  try {
    const result = await client.fetchQuery({ queryKey: ["name-dictionary"], queryFn: fetch, ...dictionaryReadOptions, retryDelay: 0 });
    expect(result.entries).toEqual(["restored"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { client.clear(); }
});

it("stops after the retry bound and retains successful cached data on refresh failure", async () => {
  const client = new QueryClient();
  const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
  const observer = new QueryObserver(client, { queryKey: ["name-dictionary"], queryFn: fetch, ...dictionaryReadOptions, retryDelay: 0 });
  client.setQueryData(["name-dictionary"], { entries: ["last-good"] });
  try {
    const result = await observer.refetch();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.isError).toBe(true);
    expect(result.data).toEqual({ entries: ["last-good"] });
  } finally { client.clear(); }
});
