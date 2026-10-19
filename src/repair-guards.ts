import { guardAssertions, settingsChanged, ignoredAssertions, type AcceptedSettings } from "./guards.js";
import { integrityOf } from "./gate-digest.js";
import { messageOf } from "./gate-support.js";
import { treeOf } from "./repair-changes.js";
import type { CaseFileHeader, HistoryEntry } from "./schema.js";
import { activeGuards, guardBase } from "./task-guards.js";

export interface RepairVerdict {
  refused: string | null;
  accepted: AcceptedSettings;
}

const ACCEPTED: RepairVerdict = { refused: null, accepted: {} };
const refusal = (why: string): RepairVerdict => ({ refused: `The repair was refused: ${why}`, accepted: {} });

/** What every repair or triage acceptance so far was accepted as changing, a later one's fingerprint winning. */
export function acceptedOf(history: HistoryEntry[]): AcceptedSettings {
  return Object.assign({}, ...history.flatMap((entry) => (entry.t === "repair_accepted" || entry.t === "triage_accepted" ? [entry.settings] : [])));
}

/**
 * Run one repair session and judge what it alone changed. The guards run from the tree before the session, so the
 * worker's earlier work is not the repair's to answer for. A change to how tests run is accepted and returned as
 * settings to record; a deleted or renamed test, a new skip marker, a file hidden from git (a settings change the
 * repair is not excused for), or a changed custom gate module refuses it. Whatever cannot be worked out refuses it:
 * a repair no guard looked at is never a pass. A run with no pinned base is judged by its gate alone, as before.
 */
export async function judgedRepair<T>(
  worktreePath: string,
  { header, repoPath, history }: { header: CaseFileHeader; repoPath: string; history: HistoryEntry[] },
  session: () => Promise<T>,
): Promise<{ result: T; verdict: RepairVerdict }> {
  const base = guardBase(header);
  if (base === null) return { result: await session(), verdict: ACCEPTED };
  const active = activeGuards(header.taskDef);
  let before: { tree: string; start: string; ignored: Set<string> } | undefined;
  try {
    before = { tree: await treeOf(worktreePath), start: base.commit, ignored: new Set((await ignoredAssertions(worktreePath, active)).map((a) => a.id)) };
  } catch {
    before = undefined;
  }
  const result = await session();
  if (before === undefined) return { result, verdict: refusal("what it changed could not be checked against the guards") };
  try {
    const after = await treeOf(worktreePath);
    const prior = acceptedOf(history);
    const [sinceStart, byRepair] = await Promise.all([
      settingsChanged(worktreePath, before.start, before.tree, active.lists, header.gateRef),
      settingsChanged(worktreePath, before.tree, after, active.lists, header.gateRef),
    ]);
    // Only what the repair alone changed is excused: a setting the worker changed first stays the worker's.
    const workers = new Set([...sinceStart].filter(([label, print]) => prior[label] !== print).map(([label]) => label));
    const accepted: AcceptedSettings = Object.fromEntries([...byRepair].filter(([label]) => !workers.has(label)));
    const found = (await guardAssertions(worktreePath, before.tree, active, header.gateRef, Object.fromEntries(byRepair))).filter((a) => a.outcome === "FAIL" && !before.ignored.has(a.id));
    const gate = (await integrityOf(header, repoPath)).filter((a) => a.outcome === "FAIL");
    const failed = [...found, ...gate];
    if (failed.length > 0) return { result, verdict: refusal(failed.map((a) => a.detail ?? a.id).join(" ")) };
    return { result, verdict: { refused: null, accepted } };
  } catch (err) {
    return { result, verdict: refusal(`what it changed could not be checked against the guards: ${messageOf(err)}`) };
  }
}
