import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Many tests spawn a whole child process (a demo, `delivery`, tsx); vitest's 5 s
    // default times them out whenever the machine is busy, so give every test the
    // same headroom the suite's explicit RUN_TIMEOUTs use.
    testTimeout: 60_000,
  },
});
