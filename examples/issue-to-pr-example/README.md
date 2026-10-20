# From a labelled issue to a pull request

GitHub's Copilot coding agent
([Assigning and completing issues with coding agent](https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/)):
assign an issue to the agent as you would to a teammate, and it opens a pull request that CI and
a person review. Here the label is the assignment.

| Piece | What it is |
|---|---|
| `github` source | Open issues labelled `delivery` are the work. The label is the approval: on a public repository anyone can write an issue, but only people you allow can label one. An issue edited after it was labelled is left alone until it is labelled again |
| `resolve-issue` workflow | `reproduce` writes one failing test that shows the problem (`scripts/red.mjs` checks only tests changed and they fail), then `fix`, in the same session, makes it pass without editing any test |
| `open-pr` | One pull request for everything landed, with a `Closes #<n>` line per issue, so each issue closes when you merge |

If an issue is too vague to write a test for, the agent asks its question and the item is
parked: the issue gets a `delivery:parked` label and a comment with the question. Answer with
`delivery answer <item> "..."`.

## Try it

You need a GitHub repository of your own, and `gh` installed and signed in (`gh auth status`).

```bash
cp -r examples/issue-to-pr-example ~/units
cd ~/units
git init -b main
git add -A
git commit -m "Start the units"
gh repo create units --private --source . --push
gh label create delivery
gh issue create --label delivery --title "Ounces are rounded to whole numbers" \
  --body "gramsToOunces(100) gives 4, but recipes need one decimal place: 3.5."
delivery run --sources
```

To have labelled issues picked up without you, run it on a timer:

```bash
delivery schedule enable --every 30m
```
