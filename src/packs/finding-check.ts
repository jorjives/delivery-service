// The findings system's view of an item check, kept until that system is deleted (course-correction slice 8).
import { checkItem, type CheckResult, type Where } from "../item-check.js";
import type { ItemCheck } from "../schema.js";
import type { Finding } from "./finding.js";
export { commentBlind } from "../item-check.js";
export type { CheckResult, Where };

const asItemCheck = (finding: Finding): ItemCheck =>
  finding.check.kind === "pattern-absent" || finding.check.kind === "dependency-absent"
    ? finding.check
    : { kind: "anchor-gone", path: finding.where.path, anchor: finding.anchor, ...(finding.scope === undefined ? {} : { scope: finding.scope }), ...(finding.sensitive === undefined ? {} : { sensitive: finding.sensitive }) };

export const checkFinding = (finding: Finding, where: Where): Promise<CheckResult> => checkItem(asItemCheck(finding), where);
