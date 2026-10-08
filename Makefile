.PHONY: setup verify build start package installer

# Everything a clean machine needs before `make verify` will run: the npm
# dependencies, and the pinned PostgreSQL build (QGD-ENG-0004), which is a
# ~59 MB download and so is not something `npm ci` does for everyone who
# clones. No browser is fetched: every suite drives the Electron that npm ci
# installs.
setup:
	npm ci
	node scripts/fetch-postgres.mjs

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
