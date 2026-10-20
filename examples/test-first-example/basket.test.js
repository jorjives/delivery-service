import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "./basket.js";

test("an empty basket costs nothing", () => {
  assert.equal(total([]), 0);
});

test("a basket costs the sum of its lines", () => {
  assert.equal(total([{ price: 250, quantity: 2 }, { price: 100, quantity: 1 }]), 600);
});
