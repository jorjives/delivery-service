import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAll } from "./load-all.js";

const slowly = (id) => new Promise((resolve) => setTimeout(() => resolve(`item-${id}`), Math.random() * 5));

test("loadAll returns what each id loaded, in the order of the ids", async () => {
  assert.deepEqual(await loadAll([1, 2, 3], slowly), ["item-1", "item-2", "item-3"]);
});
