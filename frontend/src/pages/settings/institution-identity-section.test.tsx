import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api-client";
import { EnglishLanguageScope } from "@/providers/language-provider-component";
import { getInstitutionIdentity, setInstitutionIdentity } from "@/lib/institution-identity";
import InstitutionIdentitySection from "./institution-identity-section";

vi.mock("@/lib/api-client",async original => ({...await original<typeof import("@/lib/api-client")>(),api:vi.fn()}));
const initial = {...getInstitutionIdentity(),hospitalNameEn:"Synthetic Hospital",hospitalNameAr:"مستشفى تجريبي",departmentNameEn:"Radiology"};
beforeEach(()=>{vi.clearAllMocks();setInstitutionIdentity(initial);vi.mocked(api).mockResolvedValue(initial);});
function setup() {
  const reauth=vi.fn();
  render(<EnglishLanguageScope><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><InstitutionIdentitySection onReAuthRequired={reauth} reauthVersion={0}/></QueryClientProvider></EnglishLanguageScope>);
  return reauth;
}
it("edits one bilingual identity and refreshes application branding only after an accepted save",async()=>{
  const user=userEvent.setup();setup();
  const input=await screen.findByLabelText("Hospital name (English)");
  expect(screen.getByLabelText("Hospital name (Arabic)").getAttribute("dir")).toBe("rtl");
  await user.clear(input);await user.type(input,"Updated Hospital");
  expect(getInstitutionIdentity().hospitalNameEn).toBe("Synthetic Hospital");
  vi.mocked(api).mockResolvedValue({...initial,hospitalNameEn:"Updated Hospital"});
  await user.click(screen.getByRole("button",{name:"Save institution identity"}));
  await waitFor(()=>expect(getInstitutionIdentity().hospitalNameEn).toBe("Updated Hospital"));
  expect(vi.mocked(api).mock.calls.at(-1)?.[0]).toBe("/settings/institution-identity");
});
it("rejects unsupported uploads and keeps save authorization at the existing reauthentication seam",async()=>{
  const user=userEvent.setup({applyAccept:false}),reauth=setup();
  const upload=await screen.findByLabelText("Hospital logo");
  await user.upload(upload,new File(["<svg/>"],"logo.svg",{type:"image/svg+xml"}));
  expect(screen.getByText("Choose a PNG or JPEG image of at most 2 MB.")).toBeTruthy();
  vi.mocked(api).mockRejectedValue(new ApiError("Reauthentication required",403));
  await user.click(screen.getByRole("button",{name:"Save institution identity"}));
  await waitFor(()=>expect(reauth).toHaveBeenCalledWith(["institution-identity"]));
});
