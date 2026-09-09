import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuditLogSection from "./audit-log-section";
import { LanguageProvider } from "@/providers/language-provider-component";

const fetchAuditEntriesMock = vi.fn();
const exportAuditCSVMock = vi.fn();

vi.mock("@/lib/api-hooks", () => ({
  fetchAuditEntries: (...args: unknown[]) => fetchAuditEntriesMock(...args),
  exportAuditCSV: (...args: unknown[]) => exportAuditCSVMock(...args),
}));

const entries = {
  entries: [
    {
      id: 1,
      changedByName: "Legacy Actor",
      changedByNameAr: "Arabic Actor",
      changedByNameEn: "English Actor",
      changedByUsername: "actor.one",
      changedByUserId: 7,
      entityType: "user",
      entityId: 7,
      actionType: "updated",
      oldValues: null,
      newValues: null,
      createdAt: "2026-08-23T10:00:00.000Z",
      category: "important" as const,
      outcome: "successful" as const,
      importance: "high" as const,
      title: "Updated user",
      summary: "User updated",
      actorLabel: "Legacy Actor",
      targetLabel: "User #7",
    },
    {
      id: 2,
      changedByName: null,
      changedByNameAr: null,
      changedByNameEn: null,
      changedByUsername: "fallback.actor",
      changedByUserId: 8,
      entityType: "user",
      entityId: 8,
      actionType: "updated",
      oldValues: null,
      newValues: null,
      createdAt: "2026-08-23T10:01:00.000Z",
      category: "important" as const,
      outcome: "successful" as const,
      importance: "high" as const,
      title: "Updated user",
      summary: "User updated",
      actorLabel: "",
      targetLabel: "User #8",
    },
  ],
  pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1, hasPreviousPage: false, hasNextPage: false, rangeStart: 1, rangeEnd: 2 },
  summary: { total: 2, important: 2, security: 0, automated: 0, other: 0, failed: 0 },
  meta: { users: [], entityTypes: [], actionTypes: [], categories: [], outcomes: [] },
};

function renderAudit(language: "ar" | "en") {
  localStorage.setItem("rispro-language", language);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={client}>
        <AuditLogSection onReAuthRequired={vi.fn()} />
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("AuditLogSection actor localization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    fetchAuditEntriesMock.mockResolvedValue(entries);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("uses the interface language for actor snapshots and falls back to username", async () => {
    const english = renderAudit("en");
    expect((await screen.findAllByText("English Actor")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("fallback.actor")).length).toBeGreaterThan(0);
    english.unmount();

    const arabic = renderAudit("ar");
    expect((await screen.findAllByText("Arabic Actor")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("fallback.actor")).length).toBeGreaterThan(0);
    arabic.unmount();
  });
});
