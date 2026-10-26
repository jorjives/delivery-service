import { describe, expect, it } from "vitest";
import { fakePackSource } from "./fake-source.js";
import { packSourceContract } from "./pack-source.contract.js";

packSourceContract("fake", async () => {
  const fake = fakePackSource();
  return {
    source: fake,
    publish: async (...a) => fake.publish(...a),
    unreachable: async () => fake.unreachable(),
    corrupt: async (n, v) => fake.corrupt(n, v),
  };
});

describe("the fake pack source", () => {
  it("records each spec it is asked for, in order", async () => {
    const fake = fakePackSource();
    fake.publish("docs-pack", "1.0.0", new Uint8Array([1]));
    const first = { name: "docs-pack", request: "latest", typed: false };
    const second = { name: "docs-pack", request: "1.0.0", typed: true };
    await fake.fetch(first);
    await fake.fetch(second);
    expect(fake.fetched).toEqual([first, second]);
  });
});
