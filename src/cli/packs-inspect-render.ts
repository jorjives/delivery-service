import { relative } from "node:path";
import { GUARD_REFUSES } from "../guards.js";
import type { ProjectBaseline, Selection, Inspection } from "../packs/inspection.js";
import type { Finding, HiddenCharacter } from "../packs/inspection-findings.js";
import { atOrAbove } from "../item-check.js";
import { showHidden, showName } from "../packs/hidden-characters.js";
import { FOLDER_NOT_IN_A_PACK, NOT_IN_A_PACK, UNUSED_INSTRUCTIONS } from "../packs/pack-folder.js";
import type { PackProblem } from "../packs/manifest.js";
import { SEVERITIES, type GuardName } from "../schema.js";
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
export function wrap(text: string, indent: string, hanging: string = indent): string[] {
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
export function orList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The local name of a workflow, from its `pack:local` name. */
const localOf = (name: string): string => name.slice(name.indexOf(":") + 1);

const plural = (count: number, noun: string): string => `${count} ${count === 1 ? noun : `${noun}s`}`;

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** Where a pack came from, as the identity line says it: its folder, the npm package an added pack was fetched from, or delivery-service itself. */
function originOf({ source }: Inspection["pack"]): string {
  if (source.kind === "built-in") return "built in to delivery-service.";
  if (source.package !== null) return `from npm: ${source.package.name} ${source.package.version}.`;
  return `from the folder ${source.path}.`;
}

function identityBlock({ pack }: Inspection): string[] {
  return [
    ...wrap(`Pack: ${pack.title}`, ""),
    ...wrap(`${pack.name}, version ${pack.version}, ${originOf(pack)}`, ""),
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
    if (workflow.kind !== "find" || workflow.offers === null || workflow.offers.length === 0) return [];
    const names = workflow.offers.map((offer) => `"${localOf(offer)}"`);
    return wrap(`An idea from "${workflow.local}" may go to ${orList(names)}, and only after you approve it.`, "  ");
  });
  return [
    "In short",
    ...wrap(pack.summary, "  "),
    ...wrap(
      `It has ${plural(pack.workflows.length, "workflow")}. A find reads your project and adds ideas to your backlog; an act changes the project for one idea.`,
      "  ",
    ),
    ...(workflows.length < pack.workflows.length
      ? wrap(`Only ${orList(workflows.map(({ local }) => `"${local}"`))} is shown here; inspect the whole pack to see the others.`, "  ")
      : []),
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

/** Where a hidden character is, as the reader is told it: the place in the pack's words, or the file's name. */
function placePhrase(hidden: HiddenCharacter): string {
  const local = localOf(hidden.workflow ?? "");
  switch (hidden.place) {
    case "title":
      return "the title";
    case "summary":
      return "the summary";
    case "source-path":
      return "the source path";
    case "project-path":
      return "the project's path";
    case "workflow-summary":
      return `the summary of ${local}`;
    case "instructions":
      return `the pack's own instructions for ${local}`;
    case "harness":
      return `the words delivery-service adds to ${local}`;
    case "file-name":
      return `the name of the file ${showName(hidden.file ?? "")}`;
  }
}

/** One sentence per workflow that widens what the agent may do, naming how. */
const wideningSentences = ({ workflows, findings }: Inspection): string[] =>
  workflows.flatMap(({ name, local }) => {
    const dimensions = findings.flatMap((finding) => (finding.code === "widens" && finding.workflow === name && finding.detail !== null ? [finding.detail] : []));
    return dimensions.length === 0 ? [] : [`"${local}" widens what the agent may do beyond your project's defaults: ${orList(dimensions)}.`];
  });

function widenBlock(inspection: Inspection): string[] {
  const widening = wideningSentences(inspection);
  // The pack-wide flag still holds when the view is narrowed, so it can say another workflow widens, though none shown does.
  const nothing = inspection.widens
    ? "Nothing in the workflow shown widens what the agent may do, but another workflow in this pack does: inspect the whole pack."
    : "Nothing in this pack widens what the agent may do beyond your project's defaults.";
  return [
    "Does it widen what the agent may do?",
    ...(widening.length === 0 ? wrap(nothing, "  ") : widening.flatMap((sentence) => wrap(sentence, "  "))),
    ...wrap("Compared: guards, sign-off, checks, landing, follow-on steps and agent options.", "  "),
    ...wrap("The instructions themselves are not analysed, so read them.", "  "),
  ];
}

/** One sentence for a finding that is a note: a sign-off limit, or a guard an older format gains. */
function noteSentence({ code, workflow, detail }: Finding): string {
  const name = `"${localOf(workflow)}"`;
  if (code === "lands-without-sign-off") return `${name} lands without asking for your sign-off once you have approved the idea.`;
  if (code === "hold-only-critical") return `${name} asks for your sign-off only for ${detail} ideas; anything rated lower lands without it.`;
  // An older-format guard always carries its guard name; the guard names are the keys of GUARD_REFUSES.
  return `${name} is refused if it ${GUARD_REFUSES[detail as GuardName]}, though the pack's file does not say so. The older format adds this guard.`;
}

/** The Item 2 sentence for one finding: a note's sentence, or for a widening, that it widens what the agent may do beyond the project's defaults. */
export function findingSentence(finding: Finding): string {
  if (finding.relation === "note") return noteSentence(finding);
  return `"${localOf(finding.workflow)}" widens what the agent may do beyond your project's defaults: ${finding.detail ?? ""}.`;
}

/** What a reader would not assume, as one sentence each: first anything that widens what the agent may do, then the acts whose limits are looser or unstated. */
function flaggedSentences(inspection: Inspection): string[] {
  const notes = inspection.findings.filter(({ relation }) => relation === "note");
  return [...wideningSentences(inspection), ...notes.map(noteSentence)];
}

/** What is worth a second look: the flagged limits, then the hidden characters and where each is. Says so when there is nothing. */
function lookAtBlock(inspection: Inspection): string[] {
  const flagged = flaggedSentences(inspection);
  const { hiddenCharacters } = inspection;
  if (flagged.length === 0 && hiddenCharacters.length === 0) {
    // A narrowed view has dropped the other workflows' findings, so it cannot say the pack as a whole is unremarkable.
    const nothing =
      inspection.workflows.length < inspection.pack.workflows.length
        ? "Nothing unusual was found in what this command checks for the workflow shown. Inspect the whole pack for the others."
        : "Nothing unusual was found in what this command checks.";
    return [
      "Things to look at",
      ...wrap(nothing, "  "),
      ...wrap("That is not a guarantee about the instructions.", "  "),
    ];
  }
  const hidden =
    hiddenCharacters.length === 0
      ? []
      : wrap(`${plural(hiddenCharacters.length, "hidden character")} in the pack's words. Each is shown as visible text where it sits.`, "  ");
  const numbered = (sentence: string, index: number): string[] => wrap(`${index + 1}. ${sentence}`, "  ", "     ");
  return [
    "Things to look at",
    ...flagged.flatMap(numbered),
    ...hidden,
    ...hiddenCharacters.flatMap((character, index) => {
      const place = character.line === null ? `column ${character.column}` : `line ${character.line}, column ${character.column}`;
      return numbered(`${character.shown} in ${placePhrase(character)}, ${place}.`, flagged.length + index);
    }),
  ];
}

/** The three questions a reader who is not technical can put to the account before using the pack. */
export const QUESTIONS_TO_ASK: readonly string[] = [
  "Do you know who wrote it?",
  "Do the instructions below match the summary above?",
  "Does anything in them ask for something your project does not need?",
];

function questionsBlock(): string[] {
  return ["Questions to ask before you use it", ...QUESTIONS_TO_ASK.flatMap((question) => wrap(question, "  "))];
}

/** What a fixture is, and that the account does not read it: only its name and size are shown, never its content. */
export const FIXTURES_NOT_READ = "Not read when the pack is used; only delivery packs check reads them, to prove the pack works. Not shown here:";

/** The fixtures the pack holds, each named with its size, or no block at all when there are none. */
function fixturesBlock({ files }: Inspection): string[] {
  const fixtures = files.filter(({ role }) => role === "fixture");
  if (fixtures.length === 0) return [];
  return [
    "Fixtures",
    ...wrap(FIXTURES_NOT_READ, "  "),
    ...fixtures.flatMap(({ path, bytes }) => wrap(`${showName(path)}, ${plural(bytes ?? 0, "byte")}`, "  ", "    ")),
  ];
}

/** The folder's documentation and housekeeping, named and never read. Prompts are not named here: the account says what they are, not what they hold. */
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
    questionsBlock(),
    fixturesBlock(inspection),
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
  return [...wrap(`Not read: ${shownPath(dir, cwd)}`, ""), ...problemLines(problems, (file) => shownPath(file, cwd)), `  ${SHOWN_NOTHING}`];
}

/**
 * Each problem by its file, shown as the caller names it, then the advice when a problem is content the pack should not
 * hold. The caller adds whatever heads and closes the list. Pure: no I/O.
 */
export function problemLines(problems: readonly PackProblem[], shown: (file: string) => string): string[] {
  const lines: string[] = [];
  for (const { file, field, message } of problems) {
    const sentence = message.endsWith(".") ? message : `${message}.`;
    const text = field === null ? `${shown(file)} ${sentence}` : `${shown(file)}: ${sentence}`;
    lines.push(...wrap(text, "  ", "    "));
  }
  if (problems.some(({ message }) => FOLDER_SENTENCES.includes(message))) {
    lines.push(...wrap("If you wrote this pack, remove what is named above. If someone else did, ask them why it is there.", "  "));
  }
  return lines;
}
