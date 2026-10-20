import test from "node:test";
import { generateEnglishFromDictionary as browserGenerate } from "../../frontend/src/lib/name-generation.js";
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

// Run parity from the backend suite so the frontend Docker build remains
// self-contained and does not need backend source files to typecheck tests.
test("browser/backend generators execute the same compound-name specification", () => {
  const dictionary = [
    { arabic_text: "عبد الرحمن", english_text: "Abdulrahman" },
    { arabic_text: "عبدالله", english_text: "Abdullah" },
    { arabic_text: "نورالدين", english_text: "Nuruddin" },
    { arabic_text: "محمد", english_text: "Mohamed" },
    { arabic_text: "فاطمة", english_text: "Fatima" },
  ];
  const browserDictionary = dictionary.map((entry) => ({ arabicText: entry.arabic_text, englishText: entry.english_text }));
  for (const input of ["عبد الرحمن محمد", "عبدالرحمن محمد", "عبد الله محمد", "نور الدين محمد", "فاطمه محمد", "مُحَمَّـد", "محمد مجهول", "", "مجهول ثان"]) {
    assert.deepEqual(browserGenerate(input, browserDictionary), generateEnglishFromDictionary(input, dictionary), input);
  }
});
