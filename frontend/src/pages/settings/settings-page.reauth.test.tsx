import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { LanguageProvider } from "@/providers/language-provider-component";
import { t } from "@/lib/i18n";
import SettingsPage from "./settings-page";
import { isReAuthRequiredError } from "./settings-page.helpers";

const testables = vi.hoisted(() => ({
  auth: {
    user: { id: 1, username: "settings-test", fullName: "Settings Test", role: "super_admin" },
    reAuth: vi.fn(),
    reAuthWithPasskey: vi.fn(),
  },
  queryCalls: new Map<string, number>(),
}));

vi.mock("@/providers/auth-provider", () => ({ useAuth: () => testables.auth }));

function ProtectedSection({ label, queryKey, onReAuthRequired }: { label: string; queryKey: string[]; onReAuthRequired: (key: string[]) => void }) {
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const key = queryKey.join("/");
      const calls = (testables.queryCalls.get(key) ?? 0) + 1;
      testables.queryCalls.set(key, calls);
      if (calls === 1) throw new ApiError("Recent supervisor re-authentication is required.", 403);
      return { label };
    },
  });

  useEffect(() => {
    if (query.error) onReAuthRequired(queryKey);
  }, [onReAuthRequired, query.error, queryKey]);

  if (query.error) {
    return <><p>Re-authentication required</p><button type="button" onClick={() => onReAuthRequired(queryKey)}>Re-authenticate</button></>;
  }
  return query.data ? <div>{label}</div> : <p>Loading</p>;
}

function LocationProbe() {
  return <output data-testid="settings-location">{useLocation().search}</output>;
}

const PACS_QUERY_KEY = ["pacs", "auto-completion-settings"];
const USERS_QUERY_KEY = ["users"];

vi.mock("./pacs-settings-section", () => ({
  default: (props: { onReAuthRequired: (key: string[]) => void }) => <ProtectedSection {...props} label="Protected PACS content" queryKey={PACS_QUERY_KEY} />,
}));

vi.mock("./users-section", () => ({
  default: (props: { onReAuthRequired: (key: string[]) => void }) => <ProtectedSection {...props} label="Protected users content" queryKey={USERS_QUERY_KEY} />,
}));

function renderSettings(entry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}><SettingsPage /><LocationProbe /></MemoryRouter>
      </QueryClientProvider>
    </LanguageProvider>,
  );
}

describe("SettingsPage re-auth continuation", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    testables.auth.reAuth.mockReset();
    testables.auth.reAuthWithPasskey.mockReset();
    testables.auth.reAuth.mockResolvedValue(undefined);
    testables.auth.reAuthWithPasskey.mockResolvedValue(undefined);
    testables.queryCalls.clear();
  });

  it("detects backend re-auth prompts from errors", () => {
    expect(isReAuthRequiredError(new ApiError("Recent supervisor re-authentication is required.", 403))).toBe(true);
    expect(isReAuthRequiredError(new Error("403 Forbidden"))).toBe(true);
    expect(isReAuthRequiredError(new Error("Supervisor re-authentication required"))).toBe(true);
    expect(isReAuthRequiredError(new Error("Failed to save role page visibility."))).toBe(false);
  });

  it("keeps the PACS section and query parameters through invalid and successful password re-auth", async () => {
    const user = userEvent.setup();
    testables.auth.reAuth.mockRejectedValueOnce(Object.assign(new Error("Invalid username or password."), { status: 401 }));
    renderSettings("/settings?section=pacs_connection&source=operations");

    await user.click(await screen.findByRole("button", { name: "Re-authenticate" }));
    expect(await screen.findByRole("heading", { name: t("en", "reauth.title") })).toBeTruthy();
    await user.type(screen.getByPlaceholderText(t("en", "reauth.placeholder")), "wrong");
    await user.click(screen.getByRole("button", { name: t("en", "reauth.verify") }));
    expect(await screen.findByText(t("en", "reauth.invalidCredentials"))).toBeTruthy();
    expect(screen.getByRole("heading", { name: t("en", "reauth.title") })).toBeTruthy();
    expect(screen.getByTestId("settings-location").textContent).toBe("?section=pacs_connection&source=operations");

    await user.clear(screen.getByPlaceholderText(t("en", "reauth.placeholder")));
    await user.type(screen.getByPlaceholderText(t("en", "reauth.placeholder")), "correct");
    await user.click(screen.getByRole("button", { name: t("en", "reauth.verify") }));

    await waitFor(() => expect(screen.getByText("Protected PACS content")).toBeTruthy());
    expect(screen.queryByRole("heading", { name: t("en", "reauth.title") })).toBeNull();
    expect(testables.queryCalls.get("pacs/auto-completion-settings")).toBe(2);
  });

  it("keeps the requested section secure when re-authentication is cancelled", async () => {
    const user = userEvent.setup();
    renderSettings("/settings?section=pacs_connection&source=operations");

    await user.click(await screen.findByRole("button", { name: "Re-authenticate" }));
    await user.click(screen.getByRole("button", { name: t("en", "common.cancel") }));

    expect(screen.queryByRole("heading", { name: t("en", "reauth.title") })).toBeNull();
    expect(screen.getByText("Re-authentication required")).toBeTruthy();
    expect(screen.queryByText("Protected PACS content")).toBeNull();
  });

  it("applies the same active-query continuation to another protected Settings section", async () => {
    const user = userEvent.setup();
    renderSettings("/settings?section=users&source=operations");

    await user.click(await screen.findByRole("button", { name: "Re-authenticate" }));
    await user.click(screen.getByRole("button", { name: t("en", "reauth.usePasskey") }));

    await waitFor(() => expect(screen.getByText("Protected users content")).toBeTruthy());
    expect(screen.getByTestId("settings-location").textContent).toBe("?section=users&source=operations");
    expect(testables.auth.reAuthWithPasskey).toHaveBeenCalledOnce();
    expect(testables.queryCalls.get("users")).toBe(2);
  });
});
