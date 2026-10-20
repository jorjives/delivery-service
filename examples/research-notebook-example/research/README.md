# Research

One folder per question. Each holds:

- `README.md` with three sections: `## Question`, `## Answer` and `## How to check`.
- `run.mjs`, the code that answers it. It runs with `node run.mjs` from the folder, needs no
  network, and its last line of output starts `ANSWER:`.

The answer in the README must contain that `ANSWER:` line exactly, so the claim and the evidence
cannot drift apart. `npm test` checks every folder.
