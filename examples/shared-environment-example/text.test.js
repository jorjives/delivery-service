import { test } from "node:test";
import assert from "node:assert/strict";
import { capitalise } from "./text.js";

test("capitalises the first letter of a word", () => {
  assert.equal(capitalise("hello"), "Hello");
});
