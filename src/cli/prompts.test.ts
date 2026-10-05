import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { inquirerAsk } from "./prompts.js";

/**
 * Wait for the prompt to be drawn before answering it, by watching for its own
 * words rather than by sleeping: a fixed wait would be a guess that is either
 * slow or flaky, and this fails fast if the question never appears at all.
 */
async function untilShown(shown: () => string, text: string): Promise<void> {
  for (let turn = 0; turn < 200 && !shown().includes(text); turn++) {
    await new Promise((settle) => setImmediate(settle));
  }
  expect(shown()).toContain(text);
}

describe("asking with @inquirer/prompts", () => {
  it("puts the question on the stream it was given and answers with what was typed", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk: Buffer) => (shown += chunk.toString()));

    const answer = inquirerAsk(false, { input, output }).text({ message: "What command should I run?", required: true });
    await untilShown(() => shown, "What command should I run?");
    input.write("npm test\n");

    expect(await answer).toBe("npm test");
  });

  it("says why an answer was refused and asks again, keeping the one it accepts", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk: Buffer) => (shown += chunk.toString()));

    const answer = inquirerAsk(false, { input, output }).text({
      message: "What else would you like done?",
      validate: (typed) => (typed === "the same again" ? "You've already listed that one." : true),
    });
    await untilShown(() => shown, "What else would you like done?");
    input.write("the same again\n");
    await untilShown(() => shown, "You've already listed that one.");
    // The library keeps a refused answer on the line to be edited; clear it first.
    input.write("\u0015something new\n");

    expect(await answer).toBe("something new");
  });

  it("asks which of a list to pick, every one picked to start with, and answers with what is still picked", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk: Buffer) => (shown += chunk.toString()));

    const answer = inquirerAsk(false, { input, output }).pick({
      message: "Which problems would you like fixed?",
      choices: [
        { value: "1", name: "1. First", description: "one" },
        { value: "2", name: "2. Second", description: "two" },
      ],
    });
    await untilShown(() => shown, "Which problems would you like fixed?");
    input.write(" "); // untick the first
    input.write("\n");

    expect(await answer).toEqual(["2"]);
  });
});
