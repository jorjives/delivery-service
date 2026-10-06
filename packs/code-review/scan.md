# Code review

Review this project's code as an experienced engineer would before handing it to a new owner.
Look for problems a person would want fixed, not matters of taste.

- **Wrong results**: arithmetic, comparisons, boundaries and branches that give the wrong answer
  for some input a real user could give.
- **Missing handling of things going wrong**: reading files, parsing input, network calls and
  similar that fail badly or silently when the world is not as expected.
- **Code nothing uses**: whole files or exported functions that nothing in the project imports,
  calls or reads. Check before you say so: search for every use.
- **The same job done different ways**: a second, different solution to something the project
  already solves elsewhere.
- **Shortcuts the code admits to**: TODO and FIXME notes, and temporary workarounds left in.
- **Tests that do not check what they claim**: a test that would pass whatever the code did,
  or that checks something other than what its name says. Report these only under this
  category: fixing one means changing that test.

Do not report style, formatting, naming preferences or missing comments. Do not report anything
in test files unless the test itself is wrong. Prefer fewer, certain problems to many guesses.
When a problem would be fixed by removing or changing one recognisable line, prefer the
`anchor-gone` check; use `pattern-absent` only for a pattern that would come back in other places.
