import { relative } from "node:path";
import { GUARD_REFUSES } from "../guards.js";
import type { ProjectBaseline, Selection, Inspection } from "../packs/inspection.js";
import { atOrAbove } from "../item-check.js";
import { hiddenAt, showHidden, showName, type HiddenAt } from "../packs/hidden-characters.js";
import { FOLDER_NOT_IN_A_PACK, NOT_IN_A_PACK, UNUSED_INSTRUCTIONS } from "../packs/pack-folder.js";
import type { PackProblem } from "../packs/manifest.js";
import { SEVERITIES } from "../schema.js";
import { OWN_SETUP } from "./own-setup.js";

/** The last line of every refusal: nothing from the pack was used. */
export const SHOWN_NOTHING = "Nothing from this pack was shown, run or sent to an agent.";

/** The widest line the account writes, in columns. Pack-authored instructions are the one exception: they are shown as written. */
export const INSPECT_WIDTH = 60;
/** The line that opens and closes each instruction, so a reader can see where the pack's words begin and end. */
export const INSPECT_RULE = "-".repeat(INSPECT_WIDTH);

/** Pack-authored words on one line: every hidden character, a line break included, written out as visible text. */
const oneLine = (text: string): string => showHidden(text, { newline: false, tab: false });

/** Pack-authored instructions: hidden characters written out as visible text, line breaks and tabs left as they are. */
const instructionText = (text: string): string => showHidden(text, { newline: true, tab: true });

/** Greedy word wrap on single spaces, after pack-authored text is made visible. A word too long for the width sits alone on its line, unbroken. */
function wrap(text: string, indent: string, hanging: string = indent): string[] {
  const lines: string[] = [];
  let line = indent;
  let started = false;
  for (const word of oneLine(text).split(" ")) {
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

/** One of the project's two choices as the owner reads it, or that it is not known when the project names none. */
const choiceLine = (label: string, choice: Selection | null): string[] =>
  wrap(choice === null ? `${label}: not known; your project names none and none could be inferred.` : `${label}: ${choice.summary}.`, "  ");

/** The check and landing the project's own settings name, or why they are not known. */
function projectLines(project: ProjectBaseline): string[] {
  if (!project.found) return wrap("No project was found here, so which check and landing would be used is not known.", "  ");
  if (project.config === "code") {
    return wrap("Your project's settings are in a JavaScript file, which this command does not run, so its check and landing are not known.", "  ");
  }
  if (project.config === "unreadable") return wrap("Your project's settings could not be read, so its check and landing are not known.", "  ");
  return [
    ...wrap(`Your project, in ${project.path ?? "."}:`, "  "),
    ...choiceLine("Check", project.gate),
    ...choiceLine("Landing", project.closer),
  ];
}

function checksBlock({ project }: Inspection): string[] {
  return [
    "Checks and landing",
    ...wrap("This pack chooses no checks and no way of landing. Every workflow uses your project's own.", "  "),
    ...projectLines(project),
  ];
}

/** A hidden character found in the pack's words, and which of them it was found in. */
interface Finding extends HiddenAt {
  where: string;
  /** Instructions have lines; a one-line field is placed by column alone. */
  lined: boolean;
}

const inOneLine = (where: string, text: string): Finding[] =>
  hiddenAt(text, { newline: false, tab: false }).map((found) => ({ ...found, where, lined: false }));

const inInstructions = (where: string, text: string): Finding[] =>
  hiddenAt(text, { newline: true, tab: true }).map((found) => ({ ...found, where, lined: true }));

/** Every hidden character in the pack's own words and in the names of its files, in the order a reader meets them. */
function hiddenFindings({ pack, workflows, project, files }: Inspection): Finding[] {
  return [
    ...inOneLine("the title", pack.title),
    ...inOneLine("the summary", pack.summary),
    ...inOneLine("the source path", pack.source.path),
    ...(project.path === null ? [] : inOneLine("the project's path", project.path)),
    ...workflows.flatMap((workflow) => [
      ...inOneLine(`the summary of ${workflow.local}`, workflow.summary ?? ""),
      // Every step of a workflow runs the same instructions; each distinct text is counted once.
      ...unique(workflow.steps.map(({ instructions }) => instructions.authored)).flatMap((text) =>
        inInstructions(`the pack's own instructions for ${workflow.local}`, text),
      ),
      ...unique(workflow.steps.map(({ instructions }) => instructions.harness ?? "")).flatMap((text) =>
        inInstructions(`the words delivery-service adds to ${workflow.local}`, text),
      ),
    ]),
    ...files.flatMap(({ path }) => inOneLine(`the name of the file ${showName(path)}`, path)),
  ];
}

/** One sentence per workflow that widens what the agent may do, naming how. */
const wideningSentences = ({ workflows }: Inspection): string[] =>
  workflows.filter(({ widens }) => widens.length > 0).map(({ local, widens }) => `"${local}" widens what the agent may do beyond your project's defaults: ${orList(widens)}.`);

function widenBlock(inspection: Inspection): string[] {
  const widening = wideningSentences(inspection);
  return [
    "Does it widen what the agent may do?",
    ...(widening.length === 0
      ? wrap("Nothing in this pack widens what the agent may do beyond your project's defaults.", "  ")
      : widening.flatMap((sentence) => wrap(sentence, "  "))),
    ...wrap("Compared: guards, sign-off, checks, landing, follow-on steps and agent options.", "  "),
    ...wrap("The instructions themselves are not analysed, so read them.", "  "),
  ];
}

/** What a reader would not assume, as one sentence each: first anything that widens what the agent may do, then the acts whose limits are looser or unstated. */
function flaggedSentences(inspection: Inspection): string[] {
  const { workflows } = inspection;
  return [...wideningSentences(inspection), ...workflows.flatMap((workflow) => {
    if (workflow.kind !== "act") return [];
    const name = `"${workflow.local}"`;
    const sentences: string[] = [];
    if (workflow.hold === null) sentences.push(`${name} lands without asking for your sign-off once you have approved the idea.`);
    else if (workflow.hold === "critical") sentences.push(`${name} asks for your sign-off only for ${workflow.hold} ideas; anything rated lower lands without it.`);
    for (const guard of workflow.upgraded) {
      sentences.push(`${name} is refused if it ${GUARD_REFUSES[guard]}, though the pack's file does not say so. The older format adds this guard.`);
    }
    return sentences;
  })];
}

/** What is worth a second look: the flagged limits, then the hidden characters and where each is. Says so when there is nothing. */
function lookAtBlock(inspection: Inspection): string[] {
  const flagged = flaggedSentences(inspection);
  const findings = hiddenFindings(inspection);
  if (flagged.length === 0 && findings.length === 0) {
    return [
      "Things to look at",
      ...wrap("Nothing unusual was found in what this command checks.", "  "),
      ...wrap("That is not a guarantee about the instructions.", "  "),
    ];
  }
  const hidden =
    findings.length === 0
      ? []
      : wrap(`${plural(findings.length, "hidden character")} in the pack's words. Each is shown as visible text where it sits.`, "  ");
  const numbered = (sentence: string, index: number): string[] => wrap(`${index + 1}. ${sentence}`, "  ", "     ");
  return [
    "Things to look at",
    ...flagged.flatMap(numbered),
    ...hidden,
    ...findings.flatMap((found, index) => {
      const place = found.lined ? `line ${found.line}, column ${found.column}` : `column ${found.column}`;
      return numbered(`${found.shown} in ${found.where}, ${place}.`, flagged.length + index);
    }),
  ];
}

/** The folder's documentation and housekeeping, named and never read. Fixtures and prompts are not named here: the account says what they are, not what they hold. */
function alsoBlock({ files }: Inspection): string[] {
  const listed = files.filter(({ role }) => role === "documentation" || role === "housekeeping");
  if (listed.length === 0) return [];
  return [
    "Also in the folder",
    ...wrap("Not read when the pack is used, and not shown here:", "  "),
    ...listed.flatMap(({ path }) => wrap(showName(path), "  ")),
  ];
}

/** Each step's instructions, shown unaltered: the pack's words, then the harness's words when the harness adds any. */
function instructionBlocks(inspection: Inspection): string[][] {
  return inspection.workflows.flatMap((workflow) =>
    workflow.steps.map(({ instructions }) => {
      const authored = instructionText(instructions.authored);
      const harness = instructions.harness;
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
    checksBlock(inspection),
    widenBlock(inspection),
    lookAtBlock(inspection),
    alsoBlock(inspection),
    ...instructionBlocks(inspection),
  ];
  return blocks.filter((block) => block.length > 0).flatMap((block, index) => (index === 0 ? block : ["", ...block]));
}

/** The folder sentences: a file in the folder that is not part of a pack, as the folder check words them. */
const FOLDER_SENTENCES: readonly string[] = [NOT_IN_A_PACK, FOLDER_NOT_IN_A_PACK, UNUSED_INSTRUCTIONS];

/** A path as the refusal names it: relative to the working directory, with a hidden character written out. */
const shownPath = (file: string, cwd: string): string => showName(relative(cwd, file) || ".");

/**
 * The whole account of a pack that was not read: the folder, each problem by its file, the advice when a problem is
 * content the pack should not hold, and the line that says nothing was used. Pure: no I/O.
 */
export function renderRefusal(dir: string, problems: readonly PackProblem[], cwd: string): string[] {
  const lines = wrap(`Not read: ${shownPath(dir, cwd)}`, "");
  for (const { file, field, message } of problems) {
    const sentence = message.endsWith(".") ? message : `${message}.`;
    const text = field === null ? `${shownPath(file, cwd)} ${sentence}` : `${shownPath(file, cwd)}: ${sentence}`;
    lines.push(...wrap(text, "  ", "    "));
  }
  if (problems.some(({ message }) => FOLDER_SENTENCES.includes(message))) {
    lines.push(...wrap("If you wrote this pack, remove what is named above. If someone else did, ask them why it is there.", "  "));
  }
  lines.push(`  ${SHOWN_NOTHING}`);
  return lines;
}
