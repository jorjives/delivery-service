# Rewrite the ads that are not working

Anthropic's growth marketing team
([How Anthropic teams use Claude Code](https://claude.com/blog/how-anthropic-teams-use-claude-code))
feed Claude a file of ads with their performance figures. One sub-agent finds the ads that are
underperforming, another writes replacements within the ad platform's strict character limits,
and a person reviews what comes out. Nothing here is code: the work is the words, and the checks
are rules the words must keep.

`data/ads.json` holds ten ads and how each performed. `brand.md` is the house style. The
`refresh-ads` workflow has two steps, each checked by `scripts/check-ads.mjs`:

| Step | What the agent does | What checks it |
|---|---|---|
| `pick` | Works out each ad's click-through rate and lists the four lowest in `data/underperformers.json` | `--pick`: exactly the four lowest, worked out again from the figures |
| `rewrite` | A fresh session rewrites those four, following `brand.md` and the ads that work | `--rewrite`: each of the four has a new headline and description, none breaks a length limit or uses a banned word, every other ad and every figure is unchanged |

The project's own check, run on every step, is the length limit for every ad.

## Try it

```bash
cp -r examples/ad-copy-example ~/ad-copy
cd ~/ad-copy
git init -b main
git add -A
git commit -m "Start the ads"
delivery run --task "refresh the ads that are not working" --workflow refresh-ads
git diff main <branch> -- data/ads.json
```

The check proves the copy keeps the rules, not that it is good. Read it before it goes live.
