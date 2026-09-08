# Makefile: autoloop's entry point for gating a run.
#
# Mirrors the CI job (.github/workflows/ci.yml): install, lint, test. A worktree
# has no shared node_modules, so `npm ci` runs every time; it's fast off the
# committed lockfile.

.PHONY: verify

verify:
	npm ci --no-audit --no-fund
	npm run lint
	npm test
