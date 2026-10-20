# Makefile: autoloop's entry point for gating a run.
#
# Mirrors the CI job (.github/workflows/ci.yml): install, then `npm test`, which
# lints, builds and runs the tests. A worktree has no shared node_modules, so
# `npm ci` runs every time; it's fast off the committed lockfile.

.PHONY: verify docs docs-serve

verify:
	npm ci --no-audit --no-fund
	npm test

# The documentation site, built as the Docs workflow builds it: the tools come
# from requirements-docs.txt and a warning fails the build.
docs:
	uvx --with-requirements requirements-docs.txt mkdocs build --strict --site-dir site

# Preview the site at http://127.0.0.1:8000 while you edit.
docs-serve:
	uvx --with-requirements requirements-docs.txt mkdocs serve
