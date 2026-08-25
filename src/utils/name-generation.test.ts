import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNameDictionaryLookup,
  generateEnglishFromDictionary,
  generateEnglishFromDictionaryLookup
} from "./name-generation.js";

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

test("compiled dictionary lookup preserves phrase matching and unresolved tokens", () => {
  const dictionary = [
    { arabic_text: "عبد الرحمن", english_text: "Abdulrahman" },
    { arabic_text: "محمد", english_text: "Mohamed" },
  ];
  const arabicFullName = "عبد الرحمن محمد مجهول";
  const expected = {
    englishName: "Abdulrahman Mohamed",
    missingTokens: ["مجهول"],
  };

  assert.deepEqual(generateEnglishFromDictionary(arabicFullName, dictionary), expected);
  assert.deepEqual(generateEnglishFromDictionaryLookup(arabicFullName, buildNameDictionaryLookup(dictionary)), expected);
});
