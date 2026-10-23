import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceHeading } from "./invoice.js";

test("an invoice heading names its number and the day it was issued", () => {
  assert.equal(invoiceHeading(7, new Date(Date.UTC(2026, 1, 1))), "Invoice 7, issued 1/2/2026");
});
