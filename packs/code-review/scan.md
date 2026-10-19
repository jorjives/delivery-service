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

Rate each problem's severity by these bands:

- **low**: Untidy or confusing, but nothing goes wrong because of it.
- **medium**: Something goes wrong in an unusual case, or the next change here is likely to break something.
- **high**: Something goes wrong in normal use: wrong results, lost work or a crash.
- **critical**: Serious harm in normal use: lost or corrupted data, or money or trust lost.

Prefer fewer, certain problems to many guesses.
When a problem would be fixed by removing or changing one recognisable line, prefer the
`anchor-gone` check; use `pattern-absent` only for a pattern that would come back in other places.
