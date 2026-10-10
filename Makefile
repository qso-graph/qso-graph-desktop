.PHONY: setup check verify build start package installer

# Everything a clean machine needs before `make verify` will run: the npm
# dependencies, the pinned ADIF release (QGD-REF-0003), about 2 MB and verified
# by SHA-256 before it is unpacked, and POTA's lists (QGD-REF-0009) — not
# something `npm ci` does for everyone who clones. No browser is fetched: every suite drives the Electron that npm ci
# installs.
setup:
	npm ci
# scripts/fetch-pota.mjs imports the POTA reader from dist/, so the build has to
# have happened. It always had on a machine that had built before, which is why
# this ordering was wrong for months without anyone noticing — the first clean
# account to run `make setup` failed on a missing dist/reference/fetch.js.
	npm run build
	node scripts/fetch-adif.mjs
	node scripts/fetch-pota.mjs

# The development pass: the suites that need no window, no package and no
# credential store. Seconds, not the better part of an hour, and it writes no
# report — make verify is still the only thing that does (QGD-TST-0001).
check:
	npm run check

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
