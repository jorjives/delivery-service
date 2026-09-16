# Sample project

A tiny project to try the harness on: one function, one test, and a `test` script, which is all
`delivery run` needs.

## Try a first run

1. Copy this folder somewhere outside the harness checkout and make it a git repository:

   ```bash
   cp -r examples/sample-project ~/sample-project
   cd ~/sample-project
   git init -b main
   git add -A
   git commit -m "Start the sample project"
   ```

2. Make sure Claude Code is signed in (`claude auth status`), or set `ANTHROPIC_API_KEY`.

3. If `delivery` is not on your `PATH` yet, run `npm run build && npm link` in the harness
   checkout.

4. Run:

   ```bash
   delivery run --task "add a function that says hello to a name, with a test"
   ```

5. When it finishes, the last message names a branch. Look at the work with
   `git log <branch>`; `main` is unchanged.

6. If the run stops before it finishes, run `delivery run` again in the same folder. It picks
   up where it left off rather than starting over.

7. To check on a run later, in a new terminal, run `delivery status` in the same folder. It
   prints what happened without changing anything: if the run needs a decision from you, that
   comes first, with the evidence behind it underneath.
