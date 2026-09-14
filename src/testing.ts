/**
 * The harness's public testing entry point, the testing seam's counterpart to
 * `index.ts`, with the same stability promise to adopters. Only the testing API
 * is exported from here; nothing else in `src/` becomes public through it.
 */
export { fakeAgentPort } from "./agent-port-double.js";
export type { RoleHandlers } from "./agent-port-double.js";
export { mockSessionEnvironment } from "./mock-session.js";
export type { MockSessionPaths } from "./mock-session.js";
export { assertFullyConsumed, expectEnvelope, promptsSent, readJournal, writeMockScript } from "./mock-script.js";
export type { JournalEvent, MockExpectation, MockScript } from "./mock-script.js";
export { runSurfaceAgainstMock } from "./scripted-surface-run.js";
export type { ScriptedSurfaceResult, ScriptedSurfaceRun } from "./scripted-surface-run.js";
