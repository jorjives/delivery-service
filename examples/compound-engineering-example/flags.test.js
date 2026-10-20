import { test } from "node:test";
import assert from "node:assert/strict";
import { isOn } from "./flags.js";

test("a flag set to true is on", () => {
  assert.equal(isOn({ "new-checkout": true }, "new-checkout"), true);
});

test("a flag that is missing is off", () => {
  assert.equal(isOn({}, "new-checkout"), false);
});
