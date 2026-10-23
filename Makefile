# Makefile: autoloop's entry point for gating a run.
#
# Mirrors the CI job (.github/workflows/ci.yml): install, then `npm test`, which
# lints, builds and runs the tests. A worktree has no shared node_modules, so
# `npm ci` runs every time; it's fast off the committed lockfile.

.PHONY: verify reinstall docs docs-serve

verify:
	npm ci --no-audit --no-fund
	npm test

# Rebuild and reinstall the global `delivery` command from this checkout, so the
# installed build never lags the source (a stale build once ignored the closer's
# `stack` setting while `delivery validate` still passed). Run by the `after`
# step in delivery.config.json and by autoloop's deploy command. `npm pack`
# builds through `prepack`; the last line fails if the install is still stale.
reinstall:
	npm ci --no-audit --no-fund
	rm -f delivery-service-*.tgz
	npm pack --silent
	npm install -g --prefix $(HOME)/.local --no-audit --no-fund ./delivery-service-*.tgz
	rm -f delivery-service-*.tgz
	test -f $(HOME)/.local/lib/node_modules/delivery-service/dist/stack-pr-closer.js

# The documentation site, built as the Docs workflow builds it: the tools come
# from requirements-docs.txt and a warning fails the build.
docs:
	uvx --with-requirements requirements-docs.txt mkdocs build --strict --site-dir site

# Preview the site at http://127.0.0.1:8000 while you edit.
docs-serve:
	uvx --with-requirements requirements-docs.txt mkdocs serve
