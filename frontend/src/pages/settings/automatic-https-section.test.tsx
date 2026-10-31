import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import AutomaticHttpsSection from "./automatic-https-section";
import { activateAutomaticHttps, checkAutomaticHttpsDns, fetchAutomaticHttpsSettings, saveAutomaticHttpsSettings, type AutomaticHttpsSettings } from "@/lib/api/settings";

vi.mock("@/lib/api/settings", () => ({ activateAutomaticHttps: vi.fn(), checkAutomaticHttpsDns: vi.fn(), fetchAutomaticHttpsSettings: vi.fn(), saveAutomaticHttpsSettings: vi.fn() }));
const settings: AutomaticHttpsSettings = { enabled: true, redirectHttpToHttps: false, httpRedirectActive: false, hostname: "rispro.nccb.com.ly", serverUrl: "https://provider.example.org", subdomain: "actual-account", fullDomain: "actual-account.provider.example.org", credentialsConfigured: true, encryptionReady: true, provisioned: true, managementTransportReady: true,
  cname: { type: "CNAME", name: "_acme-challenge.rispro.nccb.com.ly", target: "actual-account.provider.example.org" }, status: "Pending", activeHostname: null, issuer: null, expiresAt: null, renewal: "Pending activation", lastError: null, activationPending: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", new URL("http://localhost:3001"));
  vi.mocked(fetchAutomaticHttpsSettings).mockResolvedValue(settings);
  vi.mocked(saveAutomaticHttpsSettings).mockResolvedValue(settings);
  vi.mocked(checkAutomaticHttpsDns).mockResolvedValue({ valid: true });
  vi.mocked(activateAutomaticHttps).mockResolvedValue({ accepted: true });
});
function show() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><AutomaticHttpsSection onReAuthRequired={vi.fn()} reauthVersion={0} /></QueryClientProvider>); }

it("shows the actual CNAME, keeps saved credentials blank and checks DNS before activation", async () => {
  const user = userEvent.setup(); show();
  await screen.findByText("actual-account.provider.example.org");
  expect((screen.getByLabelText("Redirect HTTP to HTTPS") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("ACME-DNS password") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("ACME-DNS username") as HTMLInputElement).value).toBe("");
  expect((screen.getByRole("button", { name: "Activate HTTPS" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Check DNS" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Activate HTTPS" }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole("button", { name: "Activate HTTPS" }));
  await waitFor(() => expect(activateAutomaticHttps).toHaveBeenCalledOnce());
});

it("requires saving edits, submits credentials once and clears them from the form after save", async () => {
  const user = userEvent.setup(); show();
  await screen.findByText("actual-account.provider.example.org");
  await user.type(screen.getByLabelText("ACME-DNS username"), "new-account");
  await user.type(screen.getByLabelText("ACME-DNS password"), "synthetic-password");
  expect((screen.getByRole("button", { name: "Check DNS" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save Configuration" }));
  await waitFor(() => expect(saveAutomaticHttpsSettings).toHaveBeenCalledWith(expect.objectContaining({ username: "new-account", password: "synthetic-password" })));
  await waitFor(() => expect((screen.getByLabelText("ACME-DNS password") as HTMLInputElement).value).toBe(""));
});

it("blocks credential entry from ordinary remote HTTP and explains protected bootstrap", async () => {
  vi.stubGlobal("location", new URL("http://192.168.20.10:3000")); show();
  await screen.findByText("actual-account.provider.example.org");
  expect((screen.getByLabelText("ACME-DNS password") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/http:\/\/localhost:3001/)).toBeTruthy();
});

it("keeps credentials disabled when a browser HTTPS origin has no verified hospital-side transport", async () => {
  vi.stubGlobal("location", new URL("https://rispro.nccb.com.ly"));
  vi.mocked(fetchAutomaticHttpsSettings).mockResolvedValue({ ...settings, managementTransportReady: false });
  show();
  await screen.findByText("actual-account.provider.example.org");
  expect((screen.getByLabelText("ACME-DNS password") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Save Configuration" }) as HTMLButtonElement).disabled).toBe(true);
});
