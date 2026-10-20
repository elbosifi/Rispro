import { describe, expect, it } from "vitest";
import { generateEnglishFromDictionary } from "./name-generation";

const dictionary = [
  { arabic_text: "عبد الرحمن", english_text: "Abdulrahman" },
  { arabic_text: "عبدالله", english_text: "Abdullah" },
  { arabic_text: "نورالدين", english_text: "Nuruddin" },
  { arabic_text: "محمد", english_text: "Mohamed" },
  { arabic_text: "فاطمة", english_text: "Fatima" },
];
describe("Arabic compound-name specification", () => {
  it.each([
    ["عبد الرحمن محمد", "Abdulrahman Mohamed", []],
    ["عبدالرحمن محمد", "Abdulrahman Mohamed", []],
    ["عبد الله محمد", "Abdullah Mohamed", []],
    ["نور الدين محمد", "Nuruddin Mohamed", []],
    ["فاطمه محمد", "Fatima Mohamed", []],
    ["مُحَمَّـد", "Mohamed", []],
    ["محمد مجهول", "Mohamed", ["مجهول"]],
    ["", "", []],
    ["مجهول ثان", "", ["مجهول", "ثان"]],
  ])("resolves %s", (input, englishName, missingTokens) => {
    expect(generateEnglishFromDictionary(input as string, dictionary.map((entry) => ({ arabicText: entry.arabic_text, englishText: entry.english_text })))).toEqual({ englishName, missingTokens });
  });
  it("resolves the reported compound-name regression", () => {
    expect(generateEnglishFromDictionary("عبد الرحمن محمد", [{ arabicText: "عبد الرحمن", englishText: "Abdulrahman" }, { arabicText: "محمد", englishText: "Mohamed" }])).toEqual({ englishName: "Abdulrahman Mohamed", missingTokens: [] });
  });
});
