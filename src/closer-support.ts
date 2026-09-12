import type { CloserPort } from "./ports.js";

/**
 * A closer that reports the same failure however it is called. Resolution
 * failures use this so a caller never has to distinguish "failed to resolve"
 * from "failed to run" — both are just an ERROR report, exactly as `failedGate`
 * does for gates.
 */
export function failedCloser(detail: string): CloserPort {
  return { close: () => Promise.resolve({ status: "ERROR", detail }) };
}
