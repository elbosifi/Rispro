import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DateInput } from "@/components/common/date-input";
import { LanguageProvider } from "@/providers/language-provider";

describe("DateInput", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
  });

  it("auto-formats typed digits into dd/mm/yyyy and commits ISO on blur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <LanguageProvider>
        <DateInput label="Date of Birth" value="" onChange={onChange} />
      </LanguageProvider>
    );

    const input = screen.getByRole("textbox", { name: /Date of Birth/i }) as HTMLInputElement;
    await user.type(input, "01021990");
    expect(input.value).toBe("01/02/1990");

    input.blur();
    expect(onChange).toHaveBeenCalledWith("1990-02-01");
  });
});
