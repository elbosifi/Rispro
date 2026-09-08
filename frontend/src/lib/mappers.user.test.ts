import { describe, expect, it } from "vitest";
import { mapUser } from "@/lib/mappers";
import { getDoctorDisplayName, getUserDisplayName } from "@/lib/user-display-name";

describe("user bilingual name mapping and display", () => {
  it("maps snake_case and camelCase English names, including null legacy values", () => {
    expect(mapUser({ id: 1, username: "legacy", full_name: "الاسم", english_name: "English Name", role: "doctor" }).englishName).toBe("English Name");
    expect(mapUser({ id: 2, username: "legacy", full_name: "الاسم", english_name: null, role: "doctor" }).englishName).toBeNull();
    expect(mapUser({ id: 3, username: "camel", fullName: "الاسم", englishName: "English Name", role: "doctor" }).englishName).toBe("English Name");
  });

  it("uses the current locale and username fallback", () => {
    const user = { username: "login", fullName: "الاسم", englishName: "English Name" };
    expect(getUserDisplayName(user, "ar")).toBe("الاسم");
    expect(getUserDisplayName(user, "en")).toBe("English Name");
    expect(getUserDisplayName({ username: "login", fullName: null, englishName: null }, "en")).toBe("login");
  });

  it("uses localized names before legacy doctor display names and usernames", () => {
    expect(getDoctorDisplayName({ username: "doctor", fullName: "Arabic Name", englishName: "English Name", displayName: "Dr Legacy" }, "en")).toBe("English Name");
    expect(getDoctorDisplayName({ username: "doctor", fullName: "Arabic Name", englishName: "English Name", displayName: "Dr Legacy" }, "ar")).toBe("Arabic Name");
    expect(getDoctorDisplayName({ username: "legacy.doc", fullName: null, englishName: null, displayName: "Dr Legacy" }, "en")).toBe("Dr Legacy");
    expect(getDoctorDisplayName({ username: "fallback.doc", fullName: null, englishName: null, displayName: null }, "ar")).toBe("fallback.doc");
  });
});
