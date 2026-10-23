import { GUARD_REFUSES } from "../guards.js";
import type { Inspection } from "../packs/inspection.js";
import { atOrAbove } from "../item-check.js";
import { SEVERITIES } from "../schema.js";
import { OWN_SETUP } from "./own-setup.js";

/** The widest line the account writes, in columns. Pack-authored instructions are the one exception: they are shown as written. */
export const INSPECT_WIDTH = 60;
/** The line that opens and closes each instruction, so a reader can see where the pack's words begin and end. */
export const INSPECT_RULE = "-".repeat(INSPECT_WIDTH);

/** Greedy word wrap on single spaces. A word too long for the width sits alone on its line, unbroken. */
function wrap(text: string, indent: string, hanging: string = indent): string[] {
  const lines: string[] = [];
  let line = indent;
  let started = false;
  for (const word of text.split(" ")) {
    if (!started) {
      line += word;
      started = true;
    } else if (line.length + 1 + word.length <= INSPECT_WIDTH) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = hanging + word;
    }
  }
  lines.push(line);
  return lines;
}

/** Names joined as a plain list: "a", "a or b", "a, b or c". */
function orList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The local name of a workflow, from its `pack:local` name. */
const localOf = (name: string): string => name.slice(name.indexOf(":") + 1);

const plural = (count: number, noun: string): string => `${count} ${count === 1 ? noun : `${noun}s`}`;

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

function identityBlock({ pack }: Inspection): string[] {
  const source = pack.source.kind === "folder" ? `from the folder ${pack.source.path}.` : "built in to delivery-service.";
  return [
    ...wrap(`Pack: ${pack.title}`, ""),
    ...wrap(`${pack.name}, version ${pack.version}, ${source}`, ""),
    ...wrap("Fingerprint, which changes if any instruction changes:", ""),
    `  ${pack.hash.slice(0, 32)}`,
    `  ${pack.hash.slice(32)}`,
  ];
}

function shortBlock({ pack, workflows }: Inspection): string[] {
  const rows = workflows.flatMap((workflow) => {
    const sentence =
      workflow.kind === "find"
        ? "Reads your project and adds ideas to your backlog. It changes nothing else."
        : (workflow.summary ?? "Changes the project for one idea.");
    return wrap(`${workflow.local} (${workflow.kind}): ${sentence}`, "  ", "    ");
  });
  const offers = workflows.flatMap((workflow) => {
    if (workflow.kind !== "find" || workflow.offers === undefined || workflow.offers.length === 0) return [];
    const names = workflow.offers.map((offer) => `"${localOf(offer)}"`);
    return wrap(`An idea from "${workflow.local}" may go to ${orList(names)}, and only after you approve it.`, "  ");
  });
  return [
    "In short",
    ...wrap(pack.summary, "  "),
    ...wrap(
      `It has ${workflows.length} workflows. A find reads your project and adds ideas to your backlog; an act changes the project for one idea.`,
      "  ",
    ),
    ...rows,
    ...offers,
  ];
}

function touchBlock(): string[] {
  return [
    "What it may touch",
    ...wrap("This pack cannot give the agent extra powers, and nothing in it takes any away. Its instructions run with everything your own agent setup can already do:", "  "),
    ...OWN_SETUP.flatMap((sentence) => wrap(sentence, "  ")),
    ...wrap("What stops a bad change landing is your project's own checks, the guards below, and the sign-off step where a workflow has one.", "  "),
    ...wrap("After a change from an act workflow lands, your project's own follow-on steps run.", "  "),
  ];
}

/** One workflow's limits: the guards it adds or turns off, and what happens to its ideas. */
function workflowLimits(workflow: Inspection["workflows"][number]): string[] {
  const added = unique(workflow.steps.flatMap((step) => step.guards.added));
  const off = unique(workflow.steps.flatMap((step) => step.guards.off));
  const guardLines = [
    ...added.map((guard) => `Also refused if it ${GUARD_REFUSES[guard]}.`),
    ...off.map((guard) => `Not refused if it ${GUARD_REFUSES[guard]}.`),
  ];
  const sentences = guardLines.length === 0 ? ["No extra guards."] : guardLines;
  if (workflow.kind === "find") {
    sentences.push("Its ideas wait for you to approve them before any act workflow runs.");
  } else if (workflow.hold === null) {
    sentences.push("Lands without asking you again, once you have approved the idea.");
  } else {
    const hold = workflow.hold;
    const rated = SEVERITIES.filter((severity) => atOrAbove(severity, hold)).reverse();
    sentences.push(`Ideas rated ${orList(rated)} wait for your sign-off before they land.`);
  }
  return [...wrap(`${workflow.local}:`, "  "), ...sentences.flatMap((sentence) => wrap(sentence, "    "))];
}

function limitsBlock(inspection: Inspection): string[] {
  return [
    "How far each workflow goes before it asks you",
    ...wrap("Every workflow is refused if it:", "  "),
    ...inspection.defaultGuards.flatMap((guard) => wrap(`- ${GUARD_REFUSES[guard]}`, "  ", "    ")),
    ...inspection.workflows.flatMap(workflowLimits),
  ];
}

function checksBlock(): string[] {
  return ["Checks and landing", ...wrap("This pack chooses no checks and no way of landing. Every workflow uses your project's own.", "  ")];
}

/** Each step's instructions, shown unaltered: the pack's words, then the harness's words when the harness adds any. */
function instructionBlocks(inspection: Inspection): string[][] {
  return inspection.workflows.flatMap((workflow) =>
    workflow.steps.map(({ instructions: { authored, harness } }) => {
      const block = [
        ...wrap(`Instructions for ${workflow.local}: the pack's own words, ${plural(authored.split("\n").length, "line")}`, ""),
        INSPECT_RULE,
        ...authored.split("\n"),
        INSPECT_RULE,
      ];
      if (harness === null) return block;
      const heading = `Added by delivery-service to every find, so the agent writes ideas in the right form: ${plural(harness.split("\n").length, "line")}`;
      return [...block, "", ...wrap(heading, ""), INSPECT_RULE, ...harness.split("\n"), INSPECT_RULE];
    }),
  );
}

/** The account of a pack, as plain lines: the short account, then the limits, then every instruction unaltered. Pure: no I/O. */
export function renderInspection(inspection: Inspection): string[] {
  const blocks = [
    identityBlock(inspection),
    shortBlock(inspection),
    touchBlock(),
    limitsBlock(inspection),
    checksBlock(),
    ...instructionBlocks(inspection),
  ];
  return blocks.flatMap((block, index) => (index === 0 ? block : ["", ...block]));
}
