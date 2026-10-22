.PHONY: help setup update after-pull check verify suite build start package installer screenshots approve-screenshots

# `make help` lists what is here. Each target is one thing a person does with
# this checkout: set it up, bring it up to date, run it, test it, and look at
# and approve its screenshots.
help:
	@echo "make setup                 install dependencies and fetch the pinned reference data (once)"
	@echo "make update                pull this branch's latest, reinstall dependencies and build"
	@echo "make start                 build and run the application"
	@echo "make check                 the fast development pass (no window, seconds)"
	@echo "make suite SUITE=stations  run one named suite, as CI runs it"
	@echo "make verify                every suite, with the report a sign-off needs"
	@echo "make screenshots           capture the screens and compare them with the approved baselines"
	@echo "make approve-screenshots BY=<who>  record the captured screens as approved, by that person"
	@echo "make package / installer   the unpacked application under out/, or the installer"

# Everything a clean machine needs before `make verify` will run: the npm
# dependencies, the pinned ADIF release (QGD-REF-0003), about 2 MB and verified
# by SHA-256 before it is unpacked, and POTA's lists (QGD-REF-0009) — not
# something `npm ci` does for everyone who clones. No browser is fetched: every suite drives the Electron that npm ci
# installs.
setup:
	npm ci
# ADIF's archive and the US county sources come before the build: the build
# turns the county sources into the county data that ships (QGD-STN-0010).
	node scripts/fetch-adif.mjs
	node scripts/fetch-counties.mjs
# scripts/fetch-pota.mjs imports the POTA reader from dist/, so the build has to
# have happened. It always had on a machine that had built before, which is why
# this ordering was wrong for months without anyone noticing — the first clean
# account to run `make setup` failed on a missing dist/reference/fetch.js.
	npm run build
	node scripts/fetch-pota.mjs

# The development pass: the suites that need no window, no package and no
# credential store. Seconds, not the better part of an hour, and it writes no
# report — make verify is still the only thing that does (QGD-TST-0001).
check:
	npm run check

verify:
	npm run verify

# This branch's latest, with its dependencies and a fresh build: what to run
# before trying a change someone has pushed. Fast-forward only, so local work
# is never merged over or lost; a checkout with local changes stops and says so.
update:
	git pull --ff-only
# Make read this file before the pull, so the rest runs from the copy just
# pulled: a step added to it takes effect on the same update. It did not when
# the county fetch was added, and the build that needed it failed (2026-10-22).
	$(MAKE) --no-print-directory after-pull

after-pull:
	npm ci
	node scripts/fetch-adif.mjs
	node scripts/fetch-counties.mjs
	npm run build

# One suite by name, as the CI window jobs run them: `make suite SUITE=stations`.
# The names are in scripts/suites.mjs.
suite:
	@test -n "$(SUITE)" || { echo "Name the suite: make suite SUITE=stations"; exit 2; }
	npm run verify -- --suites $(SUITE)

# Captures every screen in light and dark and compares it with baselines/.
# What differs is written to report/screenshots/ to look at; nothing is approved.
screenshots:
	npm run build
	node scripts/screenshots.mjs

# Approving is a judgement about what a user sees, and it is a person's, named
# (QGD-PRT-0103): `make approve-screenshots BY=KI7MT`. It records the captures
# in baselines/ and data/baseline-approval.json.
approve-screenshots:
	@test -n "$(BY)" || { echo "Say who approves: make approve-screenshots BY=<name>"; exit 2; }
	node scripts/screenshots.mjs --approve --by=$(BY)
build:
	npm run build
start:
	npm start
package:
	npm run package
installer:
	npm run installer
