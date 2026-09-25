import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { ApiError } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import MobileWidgetAccessSection from "./mobile-widget-access-section";
import { fetchWidgetPreview, fetchWidgetTokens, mutateWidgetToken, type WidgetToken } from "./mobile-widget-api";

vi.mock("./mobile-widget-api", async importOriginal => ({ ...await importOriginal<object>(), fetchWidgetPreview: vi.fn(), fetchWidgetTokens: vi.fn(), mutateWidgetToken: vi.fn() }));
const device: WidgetToken = { id:"1",deviceName:"Synthetic iPhone",tokenPrefix:"rwm_test1234",scope:"mobile.operations-summary:read",createdAt:"2026-09-25T08:00:00Z",createdBy:"1",createdByName:"Supervisor",expiresAt:"2027-03-25T08:00:00Z",lastUsedAt:null,revokedAt:null,status:"active" };
const counts = { totalAppointments:47,scheduled:21,arrived:5,waiting:6,inProgress:3,inQueue:14,completed:10,noShow:1,cancelled:1,discontinued:0,voided:0,walkIn:2 };
const secret = `rwm_${"a".repeat(43)}`;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.setItem("rispro-language","en");
  vi.mocked(fetchWidgetTokens).mockResolvedValue({ tokens:[] });
  vi.mocked(fetchWidgetPreview).mockResolvedValue({schemaVersion:1,date:"2026-09-25",timezone:"Africa/Tripoli",generatedAt:"2026-09-25T08:31:00Z",totals:counts,waiting:{count:6,oldestWaitingMinutes:42,over30Minutes:3,over60Minutes:0,unknownDurationCount:0},modalities:[]});
  vi.mocked(mutateWidgetToken).mockResolvedValue({secret});
});
function setup() {
  const queryClient = new QueryClient({ defaultOptions:{queries:{retry:false},mutations:{retry:false}} });
  const onReAuthRequired = vi.fn();
  const tree = (version:number, cancelled=0) => <LanguageProvider><QueryClientProvider client={queryClient}><MobileWidgetAccessSection onReAuthRequired={onReAuthRequired} reauthVersion={version} reauthCancelVersion={cancelled}/></QueryClientProvider></LanguageProvider>;
  const result = render(tree(0));
  return {...result, onReAuthRequired, resume:()=>result.rerender(tree(1)), cancelReauth:()=>result.rerender(tree(0,1))};
}
it("renders loading, empty devices and live aggregate preview",async()=>{
  setup(); expect(screen.getAllByText("Loading...").length).toBeGreaterThan(0);
  expect(await screen.findByText(t("en","mobileWidget.empty"))).toBeTruthy(); expect(await screen.findByText("47")).toBeTruthy();
  expect(screen.getByText("Oldest wait: 42 min")).toBeTruthy();
});
it("creates and reveals a secret once without browser storage",async()=>{
  const user=userEvent.setup(); setup(); await user.click(screen.getByRole("button",{name:"Add device"}));
  await user.type(screen.getByLabelText("Device name"),"Test phone"); await user.selectOptions(screen.getByLabelText("Expires after"),"30");
  await user.click(screen.getByRole("button",{name:"Continue"})); expect(await screen.findByText(secret)).toBeTruthy();
  expect(mutateWidgetToken).toHaveBeenCalledWith("",expect.objectContaining({deviceName:"Test phone"}));
  expect(JSON.stringify(localStorage)).not.toContain(secret); expect(JSON.stringify(sessionStorage)).not.toContain(secret);
  await user.click(screen.getByRole("button",{name:"Done"})); expect(screen.queryByText(secret)).toBeNull(); expect(screen.queryByRole("dialog")).toBeNull();
});
it("shows statuses, expiry and usage and requires rotation/revocation confirmation",async()=>{
  vi.mocked(fetchWidgetTokens).mockResolvedValue({tokens:[device,{...device,id:"2",deviceName:"Old phone",status:"expired",lastUsedAt:"2026-09-24T08:00:00Z"},{...device,id:"3",deviceName:"Revoked phone",status:"revoked"}]});
  const user=userEvent.setup(); setup(); await screen.findByText("Synthetic iPhone");
  for(const value of ["Active","Expired","Revoked"]) expect(screen.getByText(value)).toBeTruthy();
  expect(screen.getAllByText(/25 Mar 2027/).length).toBe(3); expect(screen.getByText(/24 Sept 2026/)).toBeTruthy();
  await user.click(screen.getAllByRole("button",{name:"Rotate token"})[0]); expect(mutateWidgetToken).not.toHaveBeenCalled();
  expect(screen.getByText(/current widget will stop updating/)).toBeTruthy(); await user.click(screen.getByRole("button",{name:"Continue"}));
  await screen.findByText(secret); await user.click(screen.getByRole("button",{name:"Done"}));
  await user.click(screen.getAllByRole("button",{name:"Revoke access"})[0]); expect(screen.getByText(/takes effect immediately/)).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"Cancel"})); expect(mutateWidgetToken).toHaveBeenCalledTimes(1);
  vi.mocked(mutateWidgetToken).mockResolvedValue({}); await user.click(screen.getAllByRole("button",{name:"Revoke access"})[0]); await user.click(screen.getByRole("button",{name:"Continue"}));
  await waitFor(()=>expect(mutateWidgetToken).toHaveBeenCalledWith("/1/revoke",expect.anything()));
});
it("continues the pending protected action after shared re-auth",async()=>{
  vi.mocked(mutateWidgetToken).mockRejectedValueOnce(new ApiError("Recent supervisor re-authentication is required.",403));
  const user=userEvent.setup(); const view=setup(); await user.click(screen.getByRole("button",{name:"Add device"})); await user.type(screen.getByLabelText("Device name"),"Reauth phone"); await user.click(screen.getByRole("button",{name:"Continue"}));
  await waitFor(()=>expect(view.onReAuthRequired).toHaveBeenCalled()); expect(screen.queryByText(secret)).toBeNull(); view.resume();
  expect(await screen.findByText(secret)).toBeTruthy(); expect(mutateWidgetToken).toHaveBeenCalledTimes(2);
});
it("cancel clears pending action and API failures do not reveal credentials",async()=>{
  vi.mocked(mutateWidgetToken).mockRejectedValue(new ApiError("Recent supervisor re-authentication is required.",403));
  const user=userEvent.setup(); const view=setup(); await user.click(screen.getByRole("button",{name:"Add device"})); await user.type(screen.getByLabelText("Device name"),"phone"); await user.click(screen.getByRole("button",{name:"Continue"}));
  await waitFor(()=>expect(view.onReAuthRequired).toHaveBeenCalled()); view.cancelReauth(); await user.click(screen.getByRole("button",{name:"Cancel"})); view.resume(); expect(mutateWidgetToken).toHaveBeenCalledTimes(1);
});
it("renders list, preview and mutation errors",async()=>{
  vi.mocked(fetchWidgetTokens).mockRejectedValue(new Error("offline")); vi.mocked(fetchWidgetPreview).mockRejectedValue(new Error("offline")); vi.mocked(mutateWidgetToken).mockRejectedValue(new Error("offline"));
  const user=userEvent.setup(); setup(); expect(await screen.findByText("Unable to load devices.")).toBeTruthy(); expect(await screen.findByText("Operational preview is unavailable.")).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"Add device"})); await user.type(screen.getByLabelText("Device name"),"phone"); await user.click(screen.getByRole("button",{name:"Continue"})); expect((await screen.findByRole("alert")).textContent).toContain(t("en","mobileWidget.actionError"));
});
it("supports Arabic RTL labels and accessible confirmation dialog",async()=>{
  localStorage.setItem("rispro-language","ar"); const user=userEvent.setup(); setup();
  const add=screen.getByRole("button",{name:t("ar","mobileWidget.create")}); expect(add.closest('[dir="rtl"]')).not.toBeNull();
  await user.click(add); const dialog=screen.getByRole("dialog",{name:t("ar","mobileWidget.create")});
  expect(within(dialog).getByLabelText(t("ar","mobileWidget.deviceName"))).toBeTruthy(); expect(within(dialog).getByLabelText(t("ar","mobileWidget.expiry"))).toBeTruthy();
});
