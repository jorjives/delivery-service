import { test } from "node:test";
import assert from "node:assert/strict";
import { whoIsOnCall } from "./rota.js";

const rota = { start: new Date("2026-01-05"), people: ["Ada", "Grace", "Linus"] };

test("the first person is on call in the first week", () => {
  assert.equal(whoIsOnCall(rota, new Date("2026-01-07")), "Ada");
});

test("the rota wraps round after the last person", () => {
  assert.equal(whoIsOnCall(rota, new Date("2026-01-28")), "Ada");
});
