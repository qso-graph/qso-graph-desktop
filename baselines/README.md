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

The comparison is pixel for pixel with no tolerance: the same machine drawing
the same page twice produces the same pixels, and a tolerance wide enough to
absorb a real change is a comparison that passes on anything. That also makes
these **machine-local** — another Mac renders text differently and every
baseline will differ. `QGD-SCP-0003` and `QGD-SCP-0004` defer a second
operating system and a CI matrix to Release 1, and this is one of the things
that will need an answer then.

The content is fixed so the comparison means something: one persona with a
fixed name, callsign and start date, and a log directory inside the repository
— a temporary path would change every run and redraw the Logs page every run.

The persona is called `qg-baseline-fixture`, which is not a name anybody would
choose, and that is the point. The credential core keys Keychain entries by the
service and `persona:provider`; the profile directory is not part of the key,
so a temporary profile does not isolate a fixture persona from the operator's
real credentials. A plausible name here would read somebody's saved credential
status into the baseline and could raise a Keychain prompt mid-verification.
