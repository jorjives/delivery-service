import { test } from "node:test";
import assert from "node:assert/strict";
import { label } from "./label.js";

test("label", () => assert.equal(label(2), "x4"));
