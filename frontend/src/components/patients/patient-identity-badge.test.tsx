import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { PatientIdentityBadge } from "./patient-identity-badge";

afterEach(cleanup);
beforeEach(() => localStorage.setItem("rispro-language", "en"));
afterEach(() => localStorage.removeItem("rispro-language"));

describe("PatientIdentityBadge", () => {
  it("shows the grey unverified badge by default", () => {
    render(<LanguageProvider><PatientIdentityBadge verified={false} /></LanguageProvider>);
    expect(screen.getByRole("img", { name: "Identity not verified" })).toBeTruthy();
  });

  it("shows the blue verified badge after staff verification", () => {
    render(<LanguageProvider><PatientIdentityBadge verified /></LanguageProvider>);
    expect(screen.getByRole("img", { name: "Verified identity" })).toBeTruthy();
  });

  it("can hide the unverified badge without changing verified behavior", () => {
    render(<LanguageProvider><PatientIdentityBadge verified={false} showUnverified={false} /></LanguageProvider>);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
