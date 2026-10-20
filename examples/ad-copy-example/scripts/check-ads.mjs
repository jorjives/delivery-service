// Checks the ads against the rules in brand.md, and, with --pick or --rewrite,
// checks the step that has just run.
//
//   node scripts/check-ads.mjs            every ad keeps to the rules
//   node scripts/check-ads.mjs --pick     data/underperformers.json names exactly the
//                                         four ads with the lowest click-through rate
//   node scripts/check-ads.mjs --rewrite  those four have a new headline and description,
//                                         and nothing else in data/ads.json changed
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const HOW_MANY = 4;
const BANNED = /\b(best|great|amazing)\b|!|£/i;
const ads = JSON.parse(readFileSync("data/ads.json", "utf-8"));
const problems = [];

for (const ad of ads) {
  if (ad.headline.length > 30) problems.push(`${ad.id}: the headline is ${ad.headline.length} characters, over 30`);
  if (ad.description.length > 90) problems.push(`${ad.id}: the description is ${ad.description.length} characters, over 90`);
}

const ctr = (ad) => ad.clicks / ad.impressions;
const lowest = [...ads].sort((a, b) => ctr(a) - ctr(b)).slice(0, HOW_MANY).map((ad) => ad.id).sort();

if (process.argv.includes("--pick")) {
  const picked = existsSync("data/underperformers.json") ? JSON.parse(readFileSync("data/underperformers.json", "utf-8")) : [];
  if (JSON.stringify([...picked].sort()) !== JSON.stringify(lowest)) {
    problems.push(`data/underperformers.json should list the ${HOW_MANY} ads with the lowest click-through rate (${lowest.join(", ")}), but lists ${JSON.stringify(picked)}`);
  }
}

if (process.argv.includes("--rewrite")) {
  for (const ad of ads.filter((a) => lowest.includes(a.id))) {
    if (BANNED.test(`${ad.headline} ${ad.description}`)) problems.push(`${ad.id}: uses a word or mark brand.md rules out`);
  }
  const start = process.env.DELIVERY_STEP_START ?? "HEAD";
  const before = JSON.parse(execFileSync("git", ["show", `${start}:data/ads.json`], { encoding: "utf-8" }));
  for (const old of before) {
    const now = ads.find((ad) => ad.id === old.id);
    if (now === undefined) problems.push(`${old.id} has gone`);
    else if (now.impressions !== old.impressions || now.clicks !== old.clicks) problems.push(`${old.id}: its figures changed`);
    else if (lowest.includes(old.id) && (now.headline === old.headline || now.description === old.description)) problems.push(`${old.id}: needs a new headline and description`);
    else if (!lowest.includes(old.id) && (now.headline !== old.headline || now.description !== old.description)) problems.push(`${old.id}: performs well, so it should not change`);
  }
  if (ads.length !== before.length) problems.push("ads were added or removed");
}

for (const problem of problems) console.error(problem);
if (problems.length === 0) console.log("every ad keeps to the rules");
process.exit(problems.length === 0 ? 0 : 1);
