#!/usr/bin/env node
import { runCli } from "./program.js";

/** What ends a command part way: Ctrl-C in a terminal, and the polite request to stop a supervisor or `kill` sends. */
const STOP_SIGNALS = ["SIGINT", "SIGTERM"] as const;

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  exitOnInterrupt: (exitCode, farewell) => {
    const stop = (): void => {
      process.stderr.write(`${farewell}\n`);
      process.exit(exitCode);
    };
    for (const signal of STOP_SIGNALS) process.on(signal, stop);
    return () => {
      for (const signal of STOP_SIGNALS) process.off(signal, stop);
    };
  },
});
