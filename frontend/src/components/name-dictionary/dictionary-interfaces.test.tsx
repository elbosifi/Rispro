import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { ApiError } from "@/lib/api-client";
import NameDictionaryPage from "@/pages/name-dictionary/name-dictionary-page";
import NameDictionarySection from "@/pages/settings/name-dictionary-section";
import { fetchNameDictionary, importNameDictionary, upsertNameDictionaryEntry } from "@/lib/api-hooks";
import { exportDictionaryCsv } from "@/lib/name-dictionary-csv";

vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: { role: "supervisor" }, reAuth: vi.fn(), reAuthWithPasskey: vi.fn() }) }));
vi.mock("@/lib/api-hooks", () => ({
  fetchNameDictionary: vi.fn(), fetchUnresolvedNameDictionaryPatients: vi.fn().mockResolvedValue({ patients: [], unresolvedCount: 0 }),
  importNameDictionary: vi.fn(), upsertNameDictionaryEntry: vi.fn(), updateNameDictionaryEntry: vi.fn(), deleteNameDictionaryEntry: vi.fn(), applyNameDictionaryToPatients: vi.fn(),
}));
vi.mock("@/lib/name-dictionary-csv", async (original) => ({ ...await original<typeof import("@/lib/name-dictionary-csv")>(), exportDictionaryCsv: vi.fn() }));

const entries = [{ id: 1, arabicText: "محمد", englishText: "Mohamed" }, { id: 2, arabicText: "علي", englishText: "Ali" }];
const clients: QueryClient[] = [];
function view(settings: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<LanguageProvider><QueryClientProvider client={client}>{settings ? <NameDictionarySection onReAuthRequired={vi.fn()} /> : <NameDictionaryPage />}</QueryClientProvider></LanguageProvider>);
  return client;
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.setItem("rispro-language", "en");
  vi.mocked(fetchNameDictionary).mockResolvedValue({ entries, meta: {} });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); });

for (const settings of [false, true]) describe(settings ? "Settings dictionary" : "standalone dictionary", () => {
  it("shows a loading state before data arrives", () => {
    vi.mocked(fetchNameDictionary).mockImplementation(() => new Promise(() => undefined));
    view(settings);
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No dictionary entries|No dictionary entries yet|لا توجد إدخالات/)).toBeNull();
  });
  it("shows an error rather than empty, and Retry restores the interface", async () => {
    vi.mocked(fetchNameDictionary).mockRejectedValueOnce(new ApiError("unavailable", 400));
    view(settings);
    expect(await screen.findByText(/Could not load the name dictionary/)).toBeTruthy();
    expect(screen.queryByText(/No dictionary entries/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Mohamed")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Could not load the name dictionary/)).toBeNull());
  });
  it("distinguishes a successful empty response", async () => {
    vi.mocked(fetchNameDictionary).mockResolvedValue({ entries: [], meta: {} });
    view(settings);
    expect(await screen.findByText(/No dictionary entries/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
  it("keeps existing rows after a failed background refresh", async () => {
    const client = view(settings);
    await screen.findByText("Mohamed");
    vi.mocked(fetchNameDictionary).mockRejectedValue(new ApiError("unavailable", 400));
    await client.invalidateQueries({ queryKey: ["name-dictionary"] });
    expect(await screen.findByText(/Previously loaded entries/)).toBeTruthy();
    expect(screen.getByText("Mohamed")).toBeTruthy();
    vi.mocked(fetchNameDictionary).mockResolvedValue({ entries, meta: {} });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Previously loaded entries/)).toBeNull());
  });
  it("exports a fresh complete dictionary regardless of the search filter", async () => {
    vi.mocked(exportDictionaryCsv).mockImplementation(async (fresh) => {
      expect((await fresh()).entries).toHaveLength(2); return 2;
    });
    view(settings);
    await screen.findByText("Mohamed");
    fireEvent.change(screen.getByPlaceholderText(/Search Arabic or English/i), { target: { value: "Mohamed" } });
    expect(screen.queryByText("Ali")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(fetchNameDictionary).toHaveBeenCalledTimes(2));
    expect(exportDictionaryCsv).toHaveBeenCalledTimes(1);
  });
  it("shows export failure without creating a misleading empty export", async () => {
    vi.mocked(exportDictionaryCsv).mockRejectedValue(new TypeError("offline"));
    view(settings); await screen.findByText("Mohamed");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText(/Could not export the dictionary/)).toBeTruthy();
  });
  it("imports quoted Arabic CSV through the shared parser", async () => {
    vi.mocked(importNameDictionary).mockResolvedValue({ entries: [] });
    view(settings); await screen.findByText("Mohamed");
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(['\uFEFFarabic,english\r\n"عبد الرحمن","Abdul, ""Rahman"""'], "dictionary.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(importNameDictionary).toHaveBeenCalledWith([{ arabicText: "عبد الرحمن", englishText: 'Abdul, "Rahman"' }]));
  });
});

it("does not retry privileged mutations and preserves form input for re-authentication", async () => {
  vi.mocked(upsertNameDictionaryEntry).mockRejectedValue(new ApiError("Recent supervisor re-authentication is required.", 403));
  view(false); await screen.findByText("Mohamed");
  fireEvent.change(screen.getByPlaceholderText("Arabic spelling"), { target: { value: "جديد" } });
  fireEvent.change(screen.getByPlaceholderText("English spelling"), { target: { value: "New" } });
  fireEvent.click(screen.getByRole("button", { name: /Add \/ Update/i }));
  await waitFor(() => expect(upsertNameDictionaryEntry).toHaveBeenCalledTimes(1));
  expect((screen.getByPlaceholderText("Arabic spelling") as HTMLInputElement).value).toBe("جديد");
});
