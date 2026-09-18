import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/providers/auth-provider";
import { LanguageProvider } from "@/providers/language-provider-component";
import SopsPage from "./sops-page";

const { api } = vi.hoisted(() => ({ api: { fetchSopMeta: vi.fn(), fetchSops: vi.fn(), fetchSop: vi.fn(), createSop: vi.fn(), updateSopDraft: vi.fn(), createSopRevision: vi.fn(), publishSopVersion: vi.fn(), archiveSop: vi.fn() } }));
vi.mock("@/lib/api/sops", () => api);
vi.mock("./sop-editor", () => ({
  createEmptySopDocument: (definitions: Array<{ key: string; title: string; required: boolean }>) => ({ type: "sop", version: 1, sections: definitions.map((section) => ({ ...section, content: { type: "doc", content: [{ type: "paragraph" }] } })) }),
  SopStructuredEditor: ({ value, editable, onChange }: { value: { sections: Array<{ key: string; title: string; required: boolean; content: Record<string, unknown> }> }; editable: boolean; onChange?: (next: typeof value) => void }) => <div data-testid="sop-structured-editor">{value.sections.map((section, index) => <section key={section.title}><h3>{section.title}</h3>{editable ? <><button type="button" aria-label="RTL">RTL</button><button type="button" aria-label="LTR">LTR</button><div contentEditable role="textbox" aria-label={`${section.title} content`} onInput={() => onChange?.({ ...value, sections: value.sections.map((item, itemIndex) => itemIndex === index ? { ...item, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Latest unsaved editor edit" }] }] } } : item) })} /></> : null}</section>)}</div>,
  SopReadOnlyDocument: ({ value }: { value: { sections: Array<{ title: string }>; [key: string]: unknown } }) => <div data-testid="sop-read-only-document">{value.sections.map((section) => <section key={section.title}><h3>{section.title}</h3></section>)}<pre>{JSON.stringify(value)}</pre></div>,
}));

const sections = [
  { key: "purpose", title: "Purpose", required: true }, { key: "scope", title: "Scope", required: true }, { key: "responsibilities", title: "Responsibilities", required: true }, { key: "definitions", title: "Definitions / Abbreviations", required: false }, { key: "safety", title: "Safety / Precautions", required: false }, { key: "procedure", title: "Procedure", required: true }, { key: "documentation", title: "Documentation / Records", required: false }, { key: "references", title: "References", required: false },
];
const meta = { categories: ["General", "MRI", "Patient Safety"], sections };
const documentJson = { type: "sop" as const, version: 1 as const, sections: sections.map((section) => ({ ...section, content: { type: "doc", content: [{ type: "paragraph", attrs: { dir: section.key === "purpose" ? "rtl" : "ltr" }, content: section.required ? [{ type: "text", text: section.key === "purpose" ? "إجراء MRI" : "Content" }] : undefined }] } })) };
const draftVersion = { id: 11, sopId: 7, version: "1.0", status: "draft" as const, contentJson: documentJson, changeSummary: "Initial draft", effectiveDate: "2026-10-01", createdByUserId: 1, createdByName: "Supervisor", createdByUsername: "supervisor", createdAt: "2026-09-18T10:00:00.000Z", updatedByUserId: 1, updatedByName: "Supervisor", updatedAt: "2026-09-18T10:00:00.000Z", publishedByUserId: null, publishedByName: null, publishedByUsername: null, publishedAt: null };
const publishedVersion = { ...draftVersion, id: 12, status: "published" as const, publishedByUserId: 1, publishedByName: "Supervisor", publishedByUsername: "supervisor", publishedAt: "2026-09-18T11:00:00.000Z" };
const oldVersion = { ...publishedVersion, id: 10, version: "0.9", status: "superseded" as const, changeSummary: "Previous version" };
const revisionVersion = { ...draftVersion, id: 13, version: "1.1", changeSummary: "Revision draft" };
const draftSop = { id: 7, code: "RAD-MRI-001", title: "MRI Safety", category: "MRI", status: "draft" as const, currentVersion: null, draftVersion: "1.0", currentEffectiveDate: null, createdByUserId: 1, createdByName: "Supervisor", createdAt: "2026-09-18T10:00:00.000Z", updatedByUserId: 1, updatedByName: "Supervisor", updatedAt: "2026-09-18T10:00:00.000Z" };
const publishedSop = { ...draftSop, status: "published" as const, currentVersion: "1.0", draftVersion: null, currentEffectiveDate: "2026-10-01" };
const publishedSopWithDraft = { ...publishedSop, draftVersion: "1.1" };

function renderPage(role = "supervisor", entry = "/sops") {
  localStorage.setItem("rispro-language", "en");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<LanguageProvider><AuthContext.Provider value={{ user: { id: 1, username: role, fullName: role, role: role as never }, isLoading: false, login: vi.fn(), loginWithPasskey: vi.fn(), logout: vi.fn(), reAuth: vi.fn(), reAuthWithPasskey: vi.fn(), changePassword: vi.fn() }}><QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[entry]}><Routes><Route path="/sops/new/*" element={<SopsPage />} /><Route path="/sops/:id/*" element={<SopsPage />} /><Route path="/sops/*" element={<SopsPage />} /></Routes></MemoryRouter></QueryClientProvider></AuthContext.Provider></LanguageProvider>);
}

describe("SopsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchSopMeta.mockResolvedValue(meta);
    api.fetchSops.mockResolvedValue({ sops: [publishedSop] });
    api.fetchSop.mockResolvedValue({ sop: publishedSop, versions: [publishedVersion, oldVersion] });
    api.createSop.mockResolvedValue({ sop: draftSop, version: draftVersion });
    api.updateSopDraft.mockResolvedValue({ sop: draftSop, version: draftVersion });
    api.createSopRevision.mockResolvedValue({ version: draftVersion });
    api.publishSopVersion.mockResolvedValue({ sop: publishedSop, version: publishedVersion });
    api.archiveSop.mockResolvedValue({ sop: { ...publishedSop, status: "archived" } });
  });

  it("renders the library and sends search, category, and status filters", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("heading", { name: "SOP Library" })).toBeTruthy();
    expect(await screen.findByText("RAD-MRI-001")).toBeTruthy();
    await user.type(screen.getByLabelText("Search SOPs"), "MRI");
    await user.selectOptions(screen.getByLabelText("Category"), "MRI");
    await user.selectOptions(screen.getByLabelText("Status"), "draft");
    await waitFor(() => expect(api.fetchSops).toHaveBeenLastCalledWith({ search: "MRI", category: "MRI", status: "draft" }));
  });

  it("keeps management actions out of the normal published view", async () => {
    renderPage("receptionist");
    expect(await screen.findByRole("heading", { name: "SOP Library" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New SOP" })).toBeNull();
    expect(screen.getByLabelText("Status")).toHaveProperty("disabled", true);
    expect(api.fetchSops).toHaveBeenLastCalledWith({ search: "", category: "", status: "published" });
  });

  it("shows loading, error, and empty library states", async () => {
    api.fetchSops.mockImplementationOnce(() => new Promise(() => {}));
    const loading = renderPage();
    expect(await screen.findByText("Loading SOP Library…")).toBeTruthy();
    loading.unmount();
    api.fetchSops.mockRejectedValueOnce(new Error("down"));
    renderPage();
    expect(await screen.findByText("Unable to load the SOP Library.")).toBeTruthy();
    api.fetchSops.mockResolvedValueOnce({ sops: [] });
    renderPage();
    expect(await screen.findByText("No SOPs match the selected filters.")).toBeTruthy();
  });

  it("starts the fixed eight-section editor with required controls and saves a draft", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "New SOP" }));
    expect(await screen.findByRole("heading", { name: "Create new SOP" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "RTL" })).toHaveLength(8);
    expect(screen.getAllByRole("button", { name: "LTR" })).toHaveLength(8);
    for (const title of sections.map((section) => section.title)) expect(screen.getByText(title)).toBeTruthy();
    await user.type(screen.getByLabelText("Title"), "MRI Safety");
    await user.type(screen.getByLabelText("SOP Code"), "rad-mri-002");
    await user.type(screen.getByLabelText("Change summary"), "Initial bilingual draft");
    await user.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.createSop).toHaveBeenCalled());
    expect(api.createSop.mock.calls[0][0]).toMatchObject({ title: "MRI Safety", code: "rad-mri-002", category: "General" });
    expect(api.createSop.mock.calls[0][0].contentJson.sections).toHaveLength(8);
  });

  it("confirms publishing a draft and does not expose editing for a published version", async () => {
    const user = userEvent.setup();
    api.fetchSop.mockResolvedValueOnce({ sop: draftSop, versions: [draftVersion] });
    renderPage("supervisor", "/sops/7?version=1.0");
    expect(await screen.findByRole("button", { name: "Publish SOP" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Publish SOP" }));
    expect(await screen.findByText("This version will become the active SOP. Published versions cannot be edited directly.")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Publish SOP" }).at(-1)!);
    await waitFor(() => expect(api.publishSopVersion).toHaveBeenCalledWith(7, "1.0"));

    api.fetchSop.mockResolvedValueOnce({ sop: publishedSop, versions: [publishedVersion, oldVersion] });
    renderPage("receptionist", "/sops/7?version=1.0");
    expect(await screen.findByText("Published SOP")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Draft" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Version history" })).toBeTruthy();
    expect(screen.getByText("Superseded")).toBeTruthy();
  });

  it("saves the latest editor state before publishing and renders that state read-only", async () => {
    const user = userEvent.setup();
    let savedContent = draftVersion.contentJson;
    api.fetchSop.mockResolvedValueOnce({ sop: draftSop, versions: [draftVersion] });
    api.fetchSop.mockImplementation(async () => ({ sop: publishedSop, versions: [{ ...publishedVersion, contentJson: savedContent }, oldVersion] }));
    api.updateSopDraft.mockImplementation(async (_id: number, _version: string, payload: { contentJson: typeof savedContent }) => {
      savedContent = payload.contentJson;
      return { sop: draftSop, version: { ...draftVersion, contentJson: savedContent } };
    });
    api.publishSopVersion.mockImplementation(async () => ({ sop: publishedSop, version: { ...publishedVersion, contentJson: savedContent } }));
    renderPage("supervisor", "/sops/7?version=1.0");
    const editor = await screen.findByRole("textbox", { name: "Purpose content" });
    await user.type(editor, "Latest unsaved editor edit");
    await user.click(screen.getByRole("button", { name: "Publish SOP" }));
    await user.click(screen.getAllByRole("button", { name: "Publish SOP" }).at(-1)!);
    await waitFor(() => expect(screen.getByText("Published SOP")).toBeTruthy());
    expect(api.updateSopDraft.mock.invocationCallOrder[0]).toBeLessThan(api.publishSopVersion.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(api.updateSopDraft.mock.calls[0]![2].contentJson)).toContain("Latest unsaved editor edit");
    expect(screen.getByText(/Latest unsaved editor edit/)).toBeTruthy();
  });

  it("does not publish when saving the current editor state fails", async () => {
    const user = userEvent.setup();
    api.fetchSop.mockResolvedValueOnce({ sop: draftSop, versions: [draftVersion] });
    api.fetchSop.mockResolvedValue({ sop: draftSop, versions: [draftVersion] });
    api.updateSopDraft.mockRejectedValueOnce(new Error("draft save failed"));
    renderPage("supervisor", "/sops/7?version=1.0");
    await screen.findByRole("button", { name: "Publish SOP" });
    await user.click(screen.getByRole("button", { name: "Publish SOP" }));
    await user.click(screen.getAllByRole("button", { name: "Publish SOP" }).at(-1)!);
    expect((await screen.findByRole("alert")).textContent).toContain("draft save failed");
    expect(api.publishSopVersion).not.toHaveBeenCalled();
  });

  it("locks published revision title and category while keeping revision fields editable", async () => {
    api.fetchSop.mockResolvedValueOnce({ sop: publishedSopWithDraft, versions: [revisionVersion, publishedVersion] });
    renderPage("supervisor", "/sops/7?version=1.1");
    await screen.findByRole("heading", { name: /Edit draft/ });
    expect(screen.getByLabelText("Title")).toHaveProperty("readOnly", true);
    expect(screen.getByLabelText("Category")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Effective date")).toHaveProperty("disabled", false);
    expect(screen.getByLabelText("Change summary")).toHaveProperty("readOnly", false);
  });

  it("shows the current published version to normal users while a draft revision exists", async () => {
    const user = userEvent.setup();
    api.fetchSops.mockResolvedValueOnce({ sops: [publishedSopWithDraft] });
    renderPage("receptionist");
    expect(await screen.findByText("1.0")).toBeTruthy();
    expect(screen.queryByText("1.1")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Version 1.0")).toBeTruthy();
    expect(screen.queryByText("1.1")).toBeNull();
  });

  it("warns before leaving dirty drafts and clears the warning after a successful save", async () => {
    const user = userEvent.setup();
    api.fetchSop.mockResolvedValueOnce({ sop: draftSop, versions: [draftVersion] });
    api.fetchSop.mockResolvedValue({ sop: draftSop, versions: [draftVersion] });
    renderPage("supervisor", "/sops/7?version=1.0");
    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Unsaved MRI Safety");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Discard unsaved changes?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Unsaved MRI Safety");
    await user.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.updateSopDraft).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "SOP Library" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Discard unsaved changes?" })).toBeNull();
  });

  it("exposes revision and archive actions only to management users", async () => {
    const user = userEvent.setup();
    const management = renderPage("supervisor", "/sops/7");
    expect(await screen.findByRole("button", { name: "Create New Revision" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive SOP" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create New Revision" }));
    expect(await screen.findByRole("heading", { name: "Create a new SOP revision" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    management.unmount();
    api.fetchSop.mockResolvedValueOnce({ sop: publishedSop, versions: [publishedVersion] });
    renderPage("receptionist", "/sops/7");
    expect(await screen.findByText("Published SOP")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create New Revision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive SOP" })).toBeNull();
  });
});
