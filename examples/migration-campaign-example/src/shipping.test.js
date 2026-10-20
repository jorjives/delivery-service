import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatched, expected } from "./shipping.js";

test("dispatch gives the date and time, arrival the date", () => {
  assert.equal(dispatched(new Date("2026-05-06T08:05:00Z")), "Dispatched 06/05/2026 08:05");
  assert.equal(expected(new Date("2026-05-08T00:00:00Z")), "Expected 08/05/2026");
});
