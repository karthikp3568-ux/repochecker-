import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slugify.js";

test("lowercases and hyphenates", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
});

test("strips accents", () => {
  assert.equal(slugify("Crème Brûlée"), "creme-brulee");
});

test("respects maxLength without trailing hyphens", () => {
  assert.equal(slugify("a b c d e", { maxLength: 4 }), "a-b");
});

test("rejects non-strings", () => {
  assert.throws(() => slugify(42), TypeError);
});
