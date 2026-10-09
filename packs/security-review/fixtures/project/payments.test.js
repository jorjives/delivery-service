import { test } from "node:test";
import assert from "node:assert/strict";
import { authorisation } from "./payments.js";

test("sends the key as a bearer token", () => {
  assert.match(authorisation(), /^Bearer /);
});
