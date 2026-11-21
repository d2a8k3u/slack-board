import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TONE, styleInstructions } from "./prompts.ts";

test("follows the style prompt from the settings first, then the local tone file, then the built-in style", () => {
  assert.equal(
    styleInstructions({ stylePrompt: "Write like a pirate.", toneFile: "# My tone" }),
    "Write like a pirate.",
  );
  assert.equal(styleInstructions({ stylePrompt: "   ", toneFile: "# My tone" }), "# My tone");
  assert.equal(styleInstructions({ stylePrompt: "", toneFile: null }), DEFAULT_TONE);
});
