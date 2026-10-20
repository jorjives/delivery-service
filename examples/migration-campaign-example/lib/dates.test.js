import { test } from "node:test";
import assert from "node:assert/strict";
import { format } from "./dates.js";

test("format fills in each part of the pattern", () => {
  assert.equal(format(new Date("2026-01-05T09:07:00Z"), "dd/MM/yyyy HH:mm"), "05/01/2026 09:07");
});
