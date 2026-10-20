import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, titleCase, truncate } from "./strings.js";

test("slug", () => assert.equal(slug(" Hello, World! "), "hello-world"));
test("truncate", () => assert.equal(truncate("abcdef", 4), "abc…"));
test("titleCase", () => assert.equal(titleCase("the long goodbye"), "The Long Goodbye"));
