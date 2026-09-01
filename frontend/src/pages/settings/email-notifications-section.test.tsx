import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import EmailNotificationsSection from "./email-notifications-section";

const settings = { enabled: true, senderName: "RISpro", senderEmail: "sender@example.test", replyToEmail: "", smtpHost: "smtp.example.test", smtpPort: 465, securityMode: "tls" as const, smtpUsername: "sender@example.test", connectionTimeoutSeconds: 10, passwordConfigured: true, encryptionKeyConfigured: true };
const defaultSubject = "RISpro: Additional imaging completed — {{additional_imaging_accession}}";
const defaultBody = "Patient: {{patient_name}}\nOriginal examination: {{original_examination}}\nModality: {{modality}}";
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

function renderSection() {
  let rule = { eventType: "additional_imaging_completed", enabled: true, label: "Additional imaging completed", description: "Notify the assigned reporting doctor.", recipientDescription: "Assigned reporting doctor", subjectTemplate: defaultSubject, textBodyTemplate: defaultBody, defaultSubjectTemplate: defaultSubject, defaultTextBodyTemplate: defaultBody, availableBodyPlaceholders: ["patient_name", "original_examination", "modality", "original_accession", "additional_imaging_accession", "reporting_action"], availableSubjectPlaceholders: ["original_examination", "modality", "original_accession", "additional_imaging_accession", "reporting_action"] };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/history")) return response({ history: [{ id: 1, eventType: "additional_imaging_completed", recipientEmail: "doctor@example.test", status: "accepted" }] });
    if (url.endsWith("/rules")) return response({ rules: [rule] });
    if (url.endsWith("/template")) {
      const body = JSON.parse(String(init?.body));
      rule = { ...rule, subjectTemplate: body.subjectTemplate, textBodyTemplate: body.textBodyTemplate };
      return response({ rule });
    }
    if (url.includes("/rules/") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      rule = { ...rule, enabled: body.enabled };
      return response({ rule });
    }
    return response({ settings });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<EmailNotificationsSection onReAuthRequired={vi.fn()} />);
  return { fetchMock, getRule: () => rule };
}

afterEach(() => vi.unstubAllGlobals());

describe("EmailNotificationsSection", () => {
  it("renders both email sections, loads content and guidance, and keeps activity visible", async () => {
    renderSection();
    expect(await screen.findByRole("heading", { name: "Outbound Email" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Automatic Email Notifications" })).toBeTruthy();
    expect(screen.getByText("Additional imaging completed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recent Email Activity" })).toBeTruthy();
    await userEvent.click(screen.getByText("Email content"));
    expect(screen.getByLabelText("Email subject")).toHaveProperty("value", defaultSubject);
    expect(screen.getByLabelText("Email message")).toHaveProperty("value", defaultBody);
    expect(screen.getByText("{{patient_name}} is BODY ONLY.")).toBeTruthy();
    expect(screen.queryByText(/booked|case-assigned|future/i)).toBeNull();
  });

  it("does not persist edits until Save email content and sends the template payload", async () => {
    const { fetchMock } = renderSection();
    await screen.findByRole("heading", { name: "Outbound Email" });
    await userEvent.click(screen.getByText("Email content"));
    const subject = screen.getByLabelText("Email subject");
    await userEvent.clear(subject);
    fireEvent.change(subject, { target: { value: "Custom {{modality}}" } });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Save email content" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/email-notifications/rules/additional_imaging_completed/template", expect.objectContaining({ method: "PUT", body: JSON.stringify({ subjectTemplate: "Custom {{modality}}", textBodyTemplate: defaultBody }) })));
  });

  it("restores backend defaults locally and keeps automatic enablement separate from template editing", async () => {
    const { fetchMock, getRule } = renderSection();
    await screen.findByRole("heading", { name: "Outbound Email" });
    await userEvent.click(screen.getByText("Email content"));
    const subject = screen.getByLabelText("Email subject");
    await userEvent.clear(subject);
    await userEvent.type(subject, "Temporary");
    await userEvent.click(screen.getByRole("button", { name: "Restore default" }));
    expect(subject).toHaveProperty("value", defaultSubject);

    const enabled = screen.getByRole("combobox", { name: "Additional imaging completed status" });
    await userEvent.selectOptions(enabled, "disabled");
    await waitFor(() => expect(getRule().enabled).toBe(false));
    await userEvent.clear(subject);
    await userEvent.type(subject, "Static subject");
    await userEvent.click(screen.getByRole("button", { name: "Save email content" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings/email-notifications/rules/additional_imaging_completed/template", expect.objectContaining({ method: "PUT" })));
    expect(getRule().enabled).toBe(false);
  });
});
