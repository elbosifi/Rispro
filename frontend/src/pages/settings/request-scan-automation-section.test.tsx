import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RequestScanAutomationSection from "./request-scan-automation-section";

const storedSettings = {
  enabled: true,
  server: "stored-server",
  share: "stored-share",
  domain: "WORKGROUP",
  username: "stored-user",
  passwordConfigured: true,
  incomingSubfolder: "Requests/Incoming",
  processedSubfolder: "Requests/Processed",
  failedSubfolder: "Requests/Failed",
  pollingIntervalSeconds: 15,
  fileReadyDelaySeconds: 15,
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("RequestScanAutomationSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("tests the unsaved SMB form values without persisting them", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/settings/request-scan-automation") return response({ settings: storedSettings });
      if (url === "/api/settings/request-scan-automation/test" && init?.method === "POST") return response({ ok: true });
      return response({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RequestScanAutomationSection onReAuthRequired={vi.fn()} />);
    const server = await screen.findByLabelText("SMB server");
    await userEvent.clear(server);
    await userEvent.type(server, "draft-server");
    await userEvent.type(screen.getByLabelText("Password"), "draft-password");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/request-scan-automation/test",
      expect.objectContaining({ method: "POST" })
    ));
    const testCall = fetchMock.mock.calls.find(([url, init]) => url === "/api/settings/request-scan-automation/test" && init?.method === "POST");
    expect(JSON.parse(String(testCall?.[1]?.body))).toEqual(expect.objectContaining({
      server: "draft-server",
      password: "draft-password",
      share: "stored-share",
    }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/settings/request-scan-automation",
      expect.objectContaining({ method: "PUT" })
    );
    expect(screen.getByText("SMB connection succeeded.")).toBeTruthy();
  });

  it("shows the backend error message and opens the shared re-authentication flow", async () => {
    const onReAuthRequired = vi.fn();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/settings/request-scan-automation" && init?.method === "PUT") {
        return response({ error: { message: "Recent supervisor re-authentication is required." } }, 403);
      }
      if (url === "/api/settings/request-scan-automation") return response({ settings: storedSettings });
      return response({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RequestScanAutomationSection onReAuthRequired={onReAuthRequired} reauthVersion={2} />);
    await screen.findByLabelText("SMB server");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Recent supervisor re-authentication is required.")).toBeTruthy();
    expect(onReAuthRequired).toHaveBeenCalledWith(["settings", "request-scan-automation"]);
  });

  it("shows a clear SMB test error when an upstream response is not JSON", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/settings/request-scan-automation") return response({ settings: storedSettings });
      if (url === "/api/settings/request-scan-automation/test" && init?.method === "POST") {
        return new Response("Bad Gateway", { status: 502, headers: { "Content-Type": "text/plain" } });
      }
      return response({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RequestScanAutomationSection onReAuthRequired={vi.fn()} />);
    await screen.findByLabelText("SMB server");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText("SMB connection test failed with HTTP 502.")).toBeTruthy();
  });
});
