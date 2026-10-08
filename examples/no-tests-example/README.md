# No-tests example

A tiny invoicing script with problems planted in it and **no tests**. It shows what a review does
when nothing can check that a fix has not broken something else: it says so, sets aside problems
it cannot check, and keeps every fix waiting for your sign-off.

## Try it

1. Copy this folder somewhere outside the harness checkout and make it a git repository:

   ```bash
   cp -r examples/no-tests-example ~/no-tests-example
   cd ~/no-tests-example
   git init -b main
   git add -A
   git commit -m "Start the invoices"
   ```

2. Make sure Claude Code is signed in (`claude auth status`), or set `ANTHROPIC_API_KEY`.

3. Review, approve the problems that have a specific check, and fix:

   ```bash
   delivery review code
   delivery findings approve 1 2
   delivery fix
   delivery findings
   ```

The review opens with a warning that the project has no tests. A problem with nothing to check it
reads "needs your decision". Every fix waits for your sign-off, whatever its severity:
`delivery findings 1 --changes` shows what changed, `delivery findings sign-off 1` merges it.

[Reviewing your project](../../docs/task-packs.md) explains what you see. To watch all of this with
a scripted agent, run `npm run demo:packs-slice-6` from a checkout of the harness.
