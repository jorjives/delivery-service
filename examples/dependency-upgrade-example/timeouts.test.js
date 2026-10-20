import { test } from "node:test";
import assert from "node:assert/strict";
import { timeout } from "./timeouts.js";

test("a timeout in seconds", () => {
  assert.equal(timeout("30s"), 30_000);
});

test("a setting that is not a duration is refused", () => {
  assert.throws(() => timeout("soon"), /not a duration/);
});
