# Screenshot baselines

One per page per theme, for `P3-screenshots` under `QGD-PRT-0103`.

**These are captured, not approved.** Approval is KI7MT's and happens at the
Part's exit gate: he looks at the images and says yes. What `make verify` does
is narrower and is the whole of what the test is for — it fails when one of
them changes unexpectedly, so a change to the shell has to be looked at rather
than noticed later.

Regenerate and compare:

    node scripts/screenshots.mjs

Accept what was captured as the new baseline:

    node scripts/screenshots.mjs --approve

Approving is a separate command on purpose. A changed screen must not be able
to become the expected screen by being run past.

The comparison allows **two shades per colour channel** (`RENDER_TOLERANCE` in
`scripts/png.mjs`) and nothing more (KI7MT, 2026-10-22). The same Mac drew drop
shadows one shade apart over ssh and in a logged-in session, and macOS updates,
displays and machines move them too: variables without end, none of them the
product. Two shades absorbs that, and nothing a person would call a change:
`tests/png.test.mjs` holds that text moved by one pixel and a colour shifted by
three shades still fail. Text drawn by another Mac differs by far more, so
these are still **machine-local**: `QGD-SCP-0003` and `QGD-SCP-0004` defer a
second operating system and a CI matrix to Release 1.

A baseline that no capture produces any more fails the suite. A screen that
was renamed or removed takes its baseline with it, recorded under `retired` in
`data/baseline-approval.json` after its last approval.

The content is fixed so the comparison means something: one persona with a
fixed name, callsign and start date, and a log directory inside the repository
— a temporary path would change every run and redraw the Logs page every run.

The persona is called `qg-baseline-fixture`, which is not a name anybody would
choose, and that is the point. The credential core keys Keychain entries by the
service and `persona:provider`; the profile directory is not part of the key,
so a temporary profile does not isolate a fixture persona from the operator's
real credentials. A plausible name here would read somebody's saved credential
status into the baseline and could raise a Keychain prompt mid-verification.
