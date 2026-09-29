import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import DeploymentIdentitySection from "./deployment-identity-section";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import { fetchDeploymentIdentitySettings, saveDeploymentIdentitySettings } from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", async (original) => ({ ...(await original<typeof import("@/lib/api-hooks")>()), fetchDeploymentIdentitySettings: vi.fn(), saveDeploymentIdentitySettings: vi.fn() }));

function renderSection() {
  return render(<EnglishLanguageScope><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><DeploymentIdentitySection onReAuthRequired={vi.fn()} reauthVersion={0} /></QueryClientProvider></EnglishLanguageScope>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDeploymentIdentitySettings).mockResolvedValue({ publicAppBaseUrl: "https://rispro.nccb.com.ly", updatedAt: "2026-01-01T00:00:00.000Z" });
  vi.mocked(saveDeploymentIdentitySettings).mockResolvedValue({ publicAppBaseUrl: "http://localhost:3000", updatedAt: "2026-01-01T00:00:01.000Z" });
});

it("loads, populates from the current browser without saving, and saves the normalized response", async () => {
  const user = userEvent.setup();
  renderSection();
  const input = await screen.findByLabelText("Public RISpro URL");
  await waitFor(() => expect((input as HTMLInputElement).value).toBe("https://rispro.nccb.com.ly"));
  await user.click(screen.getByRole("button", { name: "Use current browser address" }));
  expect(saveDeploymentIdentitySettings).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveDeploymentIdentitySettings).toHaveBeenCalledTimes(1));
  expect((input as HTMLInputElement).value).toBe("http://localhost:3000");
});
