import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyFormat } from "../lib/legacy-dates.js";
import { receiptLine } from "./receipt.js";

const paidOn = new Date(Date.UTC(2026, 1, 1));

test("a receipt line names the day it was paid", () => {
  assert.equal(receiptLine(12, paidOn), "Paid 12 on 1/2/2026");
});

test("a receipt's date reads as the rest of the project writes dates", () => {
  assert.equal(legacyFormat(paidOn), "1/2/2026");
});
