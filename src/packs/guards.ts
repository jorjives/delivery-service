import { z } from "zod";

/**
 * A path pattern, matched by git with glob magic: `**` crosses folders, `*`
 * does not. Written without git's own `:(...)` prefixes, which the harness adds
 * itself, so a pack can only add to what is guarded, never take paths out.
 */
export const GuardGlob = z.string().min(1).refine((glob) => !glob.startsWith(":"), "must be a path pattern such as **/*.test.*, without git's own prefixes");

/** What a fix may not touch: existing tests, the files that decide how tests run, and markers that switch a test off. */
export const GuardLists = z.object({ testGlobs: z.array(z.string()), protectedGlobs: z.array(z.string()), skipMarkers: z.array(z.string()) });
export type GuardLists = z.infer<typeof GuardLists>;

/** The lists as one fix is judged by them: `testsCategory` lets its fix change an existing test, never delete one. */
export const Guards = GuardLists.extend({ testsCategory: z.boolean() });
export type Guards = z.infer<typeof Guards>;

/** The harness's own lists, which every pack's additions extend. */
export const DEFAULT_GUARDS: GuardLists = {
  testGlobs: ["**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/*_spec.*", "**/test_*.py", "**/test/**", "**/tests/**", "**/__tests__/**", "**/spec/**"],
  protectedGlobs: [
    "**/vitest.config.*", "**/vitest.workspace.*", "**/jest.config.*", "**/karma.conf.*", "**/playwright.config.*", "**/cypress.config.*",
    "**/.mocharc*", "**/ava.config.*", "**/pytest.ini", "**/tox.ini", "**/noxfile.py", "**/conftest.py", "**/phpunit.xml*",
    ".github/workflows/**", ".gitlab-ci.yml", ".circleci/**", ".travis.yml", "azure-pipelines.yml", "Jenkinsfile", ".buildkite/**",
    "Makefile", "makefile", "GNUmakefile",
    // ponytail: test settings kept inside a general manifest (pyproject.toml [tool.pytest], setup.cfg [tool:pytest], Cargo.toml) are not guarded, as guarding the whole file would refuse every dependency change; package.json alone is read key by key (`testCommandAt`). A pack can add such a file to protectedGlobs.
    "**/.gitignore", // the ignore rules decide which files the guards below can see on a tracked path; ignored files are also checked directly (`ignoredAssertions`)
  ],
  // ponytail: a marker is a plain substring of an added line in any file, so `.skip(` in production code (a stream's skip) is refused too; narrow per file kind if that turns up in practice.
  skipMarkers: [".skip(", ".only(", "xit(", "xdescribe(", "xtest(", "@Ignore", "@Disabled", "pytest.mark.skip", "pytest.mark.xfail", "unittest.skip", "t.Skip(", "#[ignore]"],
};

const merged = (defaults: string[], added: string[] = []): string[] => [...new Set([...defaults, ...added])];

/** The defaults followed by a pack's additions, each once. */
export function guardListsFor(additions: GuardLists | undefined): GuardLists {
  return {
    testGlobs: merged(DEFAULT_GUARDS.testGlobs, additions?.testGlobs),
    protectedGlobs: merged(DEFAULT_GUARDS.protectedGlobs, additions?.protectedGlobs),
    skipMarkers: merged(DEFAULT_GUARDS.skipMarkers, additions?.skipMarkers),
  };
}
