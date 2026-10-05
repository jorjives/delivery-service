import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "./checkout.js";

test("takes the discount off the price", () => {
  assert.equal(total(10, 3), 7);
});
