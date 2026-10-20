import { test } from "node:test";
import assert from "node:assert/strict";
import { title } from "./daily-report.js";

test("the title names the day", () => {
  assert.equal(title(new Date("2026-10-20T00:00:00Z")), "Orders for 20/10/2026");
});
