import { fileURLToPath } from "node:url";
import { load } from "../case-file.js";
import { closeError } from "../closer-support.js";
import { createCommitToBranchCloser } from "../commit-to-branch-closer.js";
import type { CloseContext, CloseOutcome, CloseReport, CloserPort } from "../ports.js";
import { resolveCloser } from "../resolve-closer.js";
import type { CloserRef } from "../schema.js";
import { FixTask } from "./fix-task.js";

/** This module's own path: loaded from the installed package, outside every working copy, as the finding gate is. */
export const FINDING_CLOSER_MODULE = fileURLToPath(import.meta.url);

/** How every fix's run pins this closer. */
export const FINDING_CLOSER_REF: CloserRef = { type: "custom", modulePath: FINDING_CLOSER_MODULE };

/**
 * How a fix lands, read from what was authorised: a fix waiting for sign-off
 * is committed on its own branch and the main copy is left alone (the
 * commit-to-branch closer); any other lands the way the project chose (its
 * landing closer, merge-back by default). A fix that recorded no landing is
 * kept on its branch, so nothing reaches the main copy without a record saying
 * it may. No landing code of its own.
 */
const findingCloser: CloserPort = {
  async close(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> {
    const { header } = await load(ctx.dir);
    const task = FixTask.safeParse(header.taskDef);
    if (!task.success) return closeError("this closer lands only the fix of a problem a review found, and this task is not one");
    const { hold, landing } = task.data.authorisation;
    const closer = hold === true || landing === undefined ? createCommitToBranchCloser() : resolveCloser(landing, ctx.repoPath);
    return closer.close(ctx, outcome);
  },
};

export default findingCloser;
