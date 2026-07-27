import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthoritativeOrthancSection from "./authoritative-orthanc-section";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));
const settings = { enabled: true, baseUrl: "http://orthanc:8042", username: "rispro", timeoutSeconds: 10, verifyTls: true, displayName: "Primary", passwordConfigured: true };
function renderSection() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthoritativeOrthancSection onReAuthRequired={vi.fn()} /></QueryClientProvider>); }

describe("AuthoritativeOrthancSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.endsWith("/settings") && !options?.method) return { settings };
      if (path.endsWith("/settings") && options?.method === "PUT") return { settings };
      if (path.endsWith("/test")) return { connected: true, system: { name: "Authoritative", version: "1.12.4", apiVersion: "19" }, testedAt: "2026-07-27T10:00:00.000Z" };
      throw new Error(`Unexpected ${path}`);
    });
  });

  it("renders safe settings, retains an empty password field, and shows compact connection details", async () => {
    const user = userEvent.setup(); renderSection();
    expect(await screen.findByText("Authoritative Orthanc")).toBeTruthy();
    expect((screen.getByPlaceholderText("Configured - leave empty to retain") as HTMLInputElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/integrations/authoritative-orthanc/settings", expect.objectContaining({ method: "PUT" })));
    expect(JSON.stringify(vi.mocked(api).mock.calls)).not.toContain("secret");
    await user.click(screen.getByRole("button", { name: "Test Connection" }));
    expect((await screen.findByRole("status")).textContent).toContain("Authoritative");
    expect(screen.getByRole("status").textContent).toContain("1.12.4");
  });
});
