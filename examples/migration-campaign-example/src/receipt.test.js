import { test } from "node:test";
import assert from "node:assert/strict";
import { stamp } from "./receipt.js";

test("the stamp gives the date and time", () => {
  assert.equal(stamp(new Date("2026-03-04T15:30:00Z")), "Paid 04/03/2026 15:30");
});
