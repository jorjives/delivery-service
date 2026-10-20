# Makefile: autoloop's entry point for gating a run.
#
# Mirrors the CI job (.github/workflows/ci.yml): install, then `npm test`, which
# lints, builds and runs the tests. A worktree has no shared node_modules, so
# `npm ci` runs every time; it's fast off the committed lockfile.

.PHONY: verify docs

verify:
	npm ci --no-audit --no-fund
	npm test

# The documentation site, built as the Docs workflow builds it.
docs:
	uvx --with 'mkdocs-material~=9.7' mkdocs build --strict --site-dir site
