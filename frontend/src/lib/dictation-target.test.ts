import { afterEach, expect, it } from "vitest";
import { captureDictationTarget } from "./dictation-target";

afterEach(() => { document.body.innerHTML = ""; });
it.each([
  '<input type="password">', '<input aria-label="Patient ID">', '<input name="nationalId">', '<input placeholder="MRN">',
  '<input autocomplete="username">', '<input type="email">', '<input type="number">', '<input type="search">',
  '<input inputmode="numeric">', '<span id="label">Patient identifier</span><input aria-labelledby="label">',
  '<input aria-label="رقم الهوية">', '<textarea disabled></textarea>', '<textarea readonly></textarea>',
  '<fieldset disabled><textarea></textarea></fieldset>', '<div data-dictation="off"><textarea></textarea></div>',
  '<label>Identifier<input></label>', '<div contenteditable="true"></div>',
])("excludes unsafe or unsupported fields: %s", (html) => {
  document.body.innerHTML = html;
  expect(captureDictationTarget(document.querySelector("input, textarea, [contenteditable]"))).toBeNull();
});
it("requires unchanged content, record scope, eligibility and a connected target", () => {
  document.body.innerHTML = '<section data-dictation-context="patient:1"><textarea>Original</textarea></section>';
  const field = document.querySelector("textarea")!;
  const target = captureDictationTarget(field)!; expect(target.valid()).toBe(true);
  field.value = "Edited"; expect(target.valid()).toBe(false); field.value = "Original";
  field.parentElement!.setAttribute("data-dictation-context", "patient:2"); expect(target.valid()).toBe(false);
  field.parentElement!.setAttribute("data-dictation-context", "patient:1"); field.readOnly = true; expect(target.valid()).toBe(false);
  field.readOnly = false; field.remove(); expect(target.valid()).toBe(false);
});
it("does not target fields underneath another modal", () => {
  document.body.innerHTML = '<textarea></textarea><section role="dialog" aria-modal="true"><input></section>';
  expect(captureDictationTarget(document.querySelector("textarea"))).toBeNull();
  expect(captureDictationTarget(document.querySelector("input"))).not.toBeNull();
});
it("ignores unrelated record contexts while protecting every ancestor of the target", () => {
  document.body.innerHTML = '<section data-dictation-context="patient:1"><div data-dictation-context="appointment:10"><textarea></textarea></div></section><aside data-dictation-context="patient:2"></aside>';
  const field = document.querySelector("textarea")!;
  const target = captureDictationTarget(field)!;
  const unrelated = document.querySelector("aside")!;
  unrelated.setAttribute("data-dictation-context", "patient:3");
  expect(target.valid()).toBe(true);
  unrelated.remove();
  expect(target.valid()).toBe(true);
  field.parentElement!.parentElement!.setAttribute("data-dictation-context", "patient:4");
  expect(target.valid()).toBe(false);
});
it("rejects a reused field moved into a different record context or given a new context", () => {
  document.body.innerHTML = '<section data-dictation-context="patient:1"><textarea></textarea></section><section data-dictation-context="patient:2"></section>';
  const field = document.querySelector("textarea")!;
  const target = captureDictationTarget(field)!;
  document.querySelectorAll("section")[1].append(field);
  expect(target.valid()).toBe(false);
  const moved = captureDictationTarget(field)!;
  field.setAttribute("data-dictation-context", "appointment:3");
  expect(moved.valid()).toBe(false);
});
it("rejects a changed route even when the same field and record remain mounted", () => {
  document.body.innerHTML = '<textarea></textarea>';
  const route = window.location.href;
  const target = captureDictationTarget(document.querySelector("textarea"))!;
  try {
    window.history.replaceState(null, "", "?patient=2");
    expect(target.valid()).toBe(false);
  } finally { window.history.replaceState(null, "", route); }
});
