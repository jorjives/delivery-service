import { test } from "node:test";
import assert from "node:assert/strict";
import { dueLine } from "./invoice.js";

test("the due line gives the date", () => {
  assert.equal(dueLine(new Date("2026-02-01T00:00:00Z")), "Payment due by 01/02/2026");
});
