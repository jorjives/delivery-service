import { test } from "node:test";
import assert from "node:assert/strict";
import { double } from "./old.js";
import { price } from "./price.js";

test("price doubles", () => assert.equal(price(2), double(2)));
