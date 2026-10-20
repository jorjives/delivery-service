import { test } from "node:test";
import assert from "node:assert/strict";
import { add } from "./reading-list.js";

test("R1: adding a book returns a new list and leaves the old one alone", () => {
  const before = [];
  const after = add(before, { title: "Middlemarch", author: "George Eliot" });
  assert.deepEqual(after, [{ title: "Middlemarch", author: "George Eliot" }]);
  assert.deepEqual(before, []);
});
