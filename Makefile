.PHONY: setup verify build start package installer

# Everything a clean machine needs before `make verify` will run: the npm
# dependencies, the pinned PostgreSQL build (QGD-ENG-0004) and the pinned ADIF
# release (QGD-REF-0003) — downloads of ~59 MB and ~2 MB, verified by SHA-256
# before they are unpacked, and so not something `npm ci` does for everyone who
# clones. No browser is fetched: every suite drives the Electron that npm ci
# installs.
setup:
	npm ci
# scripts/fetch-pota.mjs imports the POTA reader from dist/, so the build has to
# have happened. It always had on a machine that had built before, which is why
# this ordering was wrong for months without anyone noticing — the first clean
# account to run `make setup` failed on a missing dist/reference/fetch.js.
	npm run build
	node scripts/fetch-postgres.mjs
	node scripts/fetch-adif.mjs
	node scripts/fetch-pota.mjs

verify:
	npm run verify
build:
	npm run build
start:
	npm start
package:
	npm run package
installer:
	npm run installer
