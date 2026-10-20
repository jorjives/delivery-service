import { test } from "node:test";
import assert from "node:assert/strict";
import { celsiusToFahrenheit, gramsToOunces } from "./units.js";

test("a pound of butter is 16 ounces", () => {
  assert.equal(gramsToOunces(454), 16);
});

test("a hot oven is 428 Fahrenheit", () => {
  assert.equal(celsiusToFahrenheit(220), 428);
});
