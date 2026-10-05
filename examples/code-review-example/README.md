# Code review example

A tiny shop with three problems planted in it for a code review to find. Its own test passes,
so the problems are ones the tests miss.

## Try a code review

1. Copy this folder somewhere outside the harness checkout and make it a git repository:

   ```bash
   cp -r examples/code-review-example ~/code-review-example
   cd ~/code-review-example
   git init -b main
   git add -A
   git commit -m "Start the shop"
   ```

2. Make sure Claude Code is signed in (`claude auth status`), or set `ANTHROPIC_API_KEY`.

3. Run `delivery review code`, then `delivery findings 1`. Nothing in the folder changes.

[Reviewing your project](../../docs/task-packs.md) explains what you see.
