import { expect, it } from "vitest";
import { cleanupMedicalDictation } from "./medical-dictation-cleanup";

const dictated = "Um MRI brain with contrast period There is a 1 point 8 by 1 point 2 centimeter enhancing lesion in the right cerebellar hemisphere period No obstructive hydrocephalus period New paragraph A separate 6 millimeter lesion is present in the left frontal lobe period";
const expected = "MRI brain with contrast. There is a 1.8 by 1.2 centimeter enhancing lesion in the right cerebellar hemisphere. No obstructive hydrocephalus.\n\nA separate 6 millimeter lesion is present in the left frontal lobe.";

it("cleans the supplied MRI dictation without changing its clinical content", () => {
  expect(cleanupMedicalDictation(dictated)).toBe(expected);
});

it.each([
  ["no mass period no edema period no midline shift period", "No mass. No edema. No midline shift."],
  ["no mass comma no edema semicolon no shift question mark", "No mass, no edema; no shift?"],
  ["no mass[PERIOD]no edema{comma}no shift{semicolon}no bleed[question mark]", "No mass. No edema, no shift; no bleed?"],
  ["findings new line no right lesion next line no left lesion new paragraph impression next paragraph no acute disease period", "Findings\nNo right lesion\nNo left lesion\n\nImpression\n\nNo acute disease."],
  ["findings{new line}no mass[next line]no edema[new paragraph]impression{next paragraph}no acute disease{ period }", "Findings\nNo mass\nNo edema\n\nImpression\n\nNo acute disease."],
  ["Um, no uh left-sided mass erm or right-sided edema period", "No left-sided mass or right-sided edema."],
  ["A 1 point 8 by 1 point 2 cm right lesion and a 0 point 05 cm left lesion period", "A 1.8 by 1.2 cm right lesion and a 0.05 cm left lesion."],
  ["Measurement -0 point 5 mm; 1.8 x 1.2 cm; 5 um; 1,200 cells.", "Measurement -0.5 mm; 1.8 x 1.2 cm; 5 um; 1,200 cells."],
  ["Measurement 1 point uh 8 cm; dose .5 mg, not 5 mg.", "Measurement 1.8 cm; dose .5 mg, not 5 mg."],
  ["Ratio 1 point 8. No left lesion.", "Ratio 1.8. No left lesion."],
  ["  no mass ,no edema ;no shift ? no hemorrhage . \r\n\r\n no hydrocephalus .  ", "No mass, no edema; no shift? No hemorrhage.\n\nNo hydrocephalus."],
  ["pH is normal. eGFR is 80. no acute finding. O-RADS 2; T1 and T2 MRI.", "pH is normal. eGFR is 80. No acute finding. O-RADS 2; T1 and T2 MRI."],
  ["", ""],
  [" \t\r\n", ""],
  ["um uh erm", ""],
] as const)("formats %j conservatively and is idempotent", (input, output) => {
  expect(cleanupMedicalDictation(input)).toBe(output);
  expect(cleanupMedicalDictation(output)).toBe(output);
  expect(cleanupMedicalDictation(cleanupMedicalDictation(input))).toBe(output);
});

it.each([
  "Last menstrual period was normal. No point tenderness. The colon is normal.",
  "During the postoperative period there was no pain.",
  "The incubation period is uncertain. A period of observation is recommended.",
  "There is a new line of treatment. Review the next paragraph of the report.",
  "A comma-shaped focus is present. A question mark remains over the diagnosis.",
  "Period pain. Observation period. Recovery period. Refractory period.",
  "A prolonged period without relief. During this time period no symptoms occurred.",
  "A lesion is absent. An O negative patient. Oh, no right or left abnormality.",
  "UM and UH are abbreviations. Humerus, serum and sternum are intact.",
  "Point tenderness at the right ankle; no left-sided pain, neither fracture nor edema.",
  "Measurement 1 point eight; point 8; 1.8 point 2; 1 point 8.2; 1 point 8 point 2.",
  "Use [colon], {point}, [period} and {period] as literal text.",
  "Symptoms period severity uncertain.",
] as const)("preserves meaningful or ambiguous wording: %s", (input) => {
  expect(cleanupMedicalDictation(input)).toBe(input);
  expect(cleanupMedicalDictation(cleanupMedicalDictation(input))).toBe(input);
});

it("keeps the supplied result unchanged when cleaned again", () => {
  expect(cleanupMedicalDictation(expected)).toBe(expected);
});
