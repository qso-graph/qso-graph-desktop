# app-api

What an application may call. `QGD-PRT-0107` is building it; this directory is
its home under `QGD-REP-0001` and is empty until it has something in it.

It is a separate package from `ui` on purpose (`QGD-REP-0004`): what an
application may **call** and what it may **look like** are different contracts,
and a component library that could also reach the engine would collapse the
two.

Three things decided before any of it is written:

- **One path, no private shortcut.** QSO Graph's own applications use the same
  message API as every other application (D-33, KI7MT 2026-10-07). A built-in
  application uses only this API and its grants, exactly as a contributed one
  would (`QGD-REP-0003`) — which is why `personas`, `engine` and `reference`
  are frame and not applications: the frame is what enforces the grants.
- **Three tiers, and the outer two sandboxed.** Official, contributed and
  unofficial (D-2, KI7MT 2026-10-05: *"we want contributors, but don't want
  them breaking the box"*). The sandbox's design is this Part's work.
- **An application without a grant is refused**, and the exit gate proves it
  both ways: a no-credential application (solar) and a granted one (QRZ
  lookup), and a test application that uses this API and nothing else.

`scripts/package-boundaries.mjs` holds the direction: an application depends on
`app-api` and `ui`, and on nothing else.
