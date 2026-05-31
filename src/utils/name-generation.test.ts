import test from "node:test";
import assert from "node:assert/strict";
import { generateEnglishFromDictionary } from "./name-generation.js";

test("generateEnglishFromDictionary matches Arabic compound aliases with or without spaces", () => {
  const dictionary = [
    { arabic_text: "عبدالله", english_text: "Abdullah" },
    { arabic_text: "عبد الرحمن", english_text: "Abdulrahman" },
    { arabic_text: "نورالدين", english_text: "Nuruddin" },
  ];

  assert.deepEqual(generateEnglishFromDictionary("عبد الله", dictionary), {
    englishName: "Abdullah",
    missingTokens: [],
  });
  assert.deepEqual(generateEnglishFromDictionary("عبدالرحمن", dictionary), {
    englishName: "Abdulrahman",
    missingTokens: [],
  });
  assert.deepEqual(generateEnglishFromDictionary("نور الدين", dictionary), {
    englishName: "Nuruddin",
    missingTokens: [],
  });
});
