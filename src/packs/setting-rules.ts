import { basename, join } from "node:path";
import { malformedSettingPlaceholders, settingNamesIn } from "../placeholders.js";
import type { PackProblem } from "./manifest.js";
import type { PackManifest } from "./pack-format.js";

/** The most settings a pack may declare. */
export const SETTINGS_MAX = 32;

/**
 * The problems with a pack's settings and the `{{settings.<name>}}` placeholders its prompts use, in the order: the count,
 * each declared setting no prompt uses, then for each prompt its malformed placeholders and then its undeclared names.
 * `texts` maps each prompt file name to its text. A manifest that declares no settings, or none at all, declares none.
 */
export function settingRuleProblems(manifestFile: string, dir: string, manifest: PackManifest, texts: ReadonlyMap<string, string>): PackProblem[] {
  const declared = Object.keys(manifest.settings ?? {});
  const declaredSet = new Set(declared);
  const manifestName = basename(manifestFile);
  const problems: PackProblem[] = [];

  if (declared.length > SETTINGS_MAX) {
    problems.push({ file: manifestFile, field: "settings", message: `"settings" declares ${declared.length} settings, but a pack may declare at most ${SETTINGS_MAX}` });
  }

  const used = new Set([...texts.values()].flatMap((text) => settingNamesIn(text)));
  for (const name of declared) {
    if (!used.has(name)) {
      problems.push({
        file: manifestFile,
        field: `settings.${name}`,
        message: `"settings.${name}" is not used by any prompt: put {{settings.${name}}} where the agent should be told it, or remove the setting`,
      });
    }
  }

  for (const [prompt, text] of texts) {
    const file = join(dir, prompt);
    for (const occurrence of malformedSettingPlaceholders(text)) {
      problems.push({
        file,
        field: null,
        message: `uses ${occurrence}, which is not a setting placeholder: a setting's name is lower-case letters, digits and dashes, as in {{settings.docs-folder}}`,
      });
    }
    for (const name of settingNamesIn(text)) {
      if (declaredSet.has(name)) continue;
      const message =
        declared.length === 0
          ? `uses {{settings.${name}}}, but ${manifestName} declares no settings`
          : `uses {{settings.${name}}}, but ${manifestName} declares no setting of that name. Declared: ${declared.join(", ")}`;
      problems.push({ file, field: null, message });
    }
  }
  return problems;
}
