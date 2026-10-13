# Code review example

A tiny shop with problems planted in it for a code review and a security review to find. Its own test passes, so the problems are ones the tests miss.

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

4. To review only the `auth` folder: `delivery review code --path auth`.

[Reviewing your project](../../docs/task-packs.md) explains what you see.

Then choose and fix:

```bash
delivery findings approve 1 2
delivery findings skip 3
delivery fix
delivery findings
```

The approved problems end "fixed and merged" (or say plainly why one could not be fixed), the
skipped one stays as it is, and `checkout.js` and `settings.js` hold the fixes.

## Try a security review

```bash
delivery review security
delivery findings approve --all
delivery fix
delivery findings
delivery findings 1 --changes
delivery findings sign-off 1
delivery findings
```

The password in `payments.js` is never shown: it appears as `pay-… (21 characters)`. Its fix is
checked and then waits for your sign-off; signing off checks it again on your main copy and
merges it, and `delivery findings` then lists changing the password at the provider under NEEDS
YOU. The old library version is fixed and merged without waiting.

To watch all of this with a scripted agent, run `npm run demo:packs-slice-4` from a checkout of the harness.
