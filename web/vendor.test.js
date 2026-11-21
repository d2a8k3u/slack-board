import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const INSTALLED_BUILD = new URL(".", import.meta.resolve("typoseek"));
const INSTALLED_LICENSE = new URL("../LICENSE", INSTALLED_BUILD);
const VENDORED = new URL("./vendor/typoseek/", import.meta.url);

const modulesIn = (folder) =>
  readdirSync(folder)
    .filter((name) => name.endsWith(".mjs"))
    .sort();

const sameBytes = (left, right) => readFileSync(left).equals(readFileSync(right));

test("keeps the vendored typoseek identical to the installed package", () => {
  const installed = modulesIn(INSTALLED_BUILD);
  assert.deepEqual(modulesIn(VENDORED), installed, "run npm run vendor");
  for (const name of installed) {
    assert.ok(
      sameBytes(new URL(name, VENDORED), new URL(name, INSTALLED_BUILD)),
      `${name} differs; run npm run vendor`,
    );
  }
  assert.ok(sameBytes(new URL("LICENSE", VENDORED), INSTALLED_LICENSE), "LICENSE differs");
});
