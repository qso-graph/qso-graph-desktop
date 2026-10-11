# Running `make verify` in the verification account

**KI7MT's decision, 2026-10-09:** `make verify` runs from the non-admin
`qgdesktop` account, so the suites never touch his login keychain.

This replaces the temporary-keychain approach Bob proposed. A separate macOS
account has its **own login keychain**, so the isolation is a property of the
operating system rather than something the suites have to keep getting right —
and it needs no change to the credential core's proven paths. The
test-service scoping (`QGD-CRD-0013`) stays as well: two independent controls,
and the one that does not depend on the suites behaving is the stronger.

It is also a better clean-machine check than the developing account can give.
`qgdesktop` is non-admin on purpose, and the P5/P6 exit gates were walked there
for the same reason.

## What the account can and cannot reach, and why that is the point

| | State | Why |
|---|---|---|
| The working repo | **Unreachable.** `/Users/gbeam` is `drwxr-x---`, so it cannot even be traversed | An account that could read the developing account's home would not be isolated from it |
| A GitHub credential | **None** | Nothing in this account should be able to write to a remote |
| Its own login keychain | Empty of the operator's credentials | The whole reason for running here |
| Rust toolchain | Shared from `/Users/Shared/rust` | Same version, no second download, no reach into another home directory |
| The checkout | `/Users/Shared/qg-desktop-verify`, world-writable | Where `dist/`, `out/`, `report/` and `target/` are written |

Because it can neither read the repo nor fetch from the remote, the commit is
pushed **across** to it from the developing side. The verification account only
ever runs what is already there.

## Each run

**1. As the developing account**, sync the checkout:

```
node scripts/sync-verify-checkout.mjs [ref]      # default: develop
```

That fetches the ref from the working tree by path, hard-resets the checkout to
it, removes anything a previous run left (keeping `node_modules` and `vendor`),
writes `verify-env.sh`, and makes it all writable.

**2. Logged in as `qgdesktop`**, run it:

```
cd /Users/Shared/qg-desktop-verify
. ./verify-env.sh
make verify
```

`verify-env.sh` sets `RUSTUP_HOME`, `CARGO_HOME` and `PATH` for the shared
toolchain. `scripts/cargo-path.mjs` resolves cargo from `CARGO_HOME`, then
`PATH`, then `~/.cargo/bin` — it used to assume the last of those, which is
true only for the account that installed rustup and is exactly the kind of
baked-in path that makes a check pass in one place and fail in another.

## First time only, in that account

```
make setup
```

That is `npm ci`, the build, and the two fetches: ADIF's definitions and POTA's
lists. All of it writes inside the checkout and none of it needs a credential.
(It fetched a pinned PostgreSQL build too, until storage became SQLite on
2026-10-10; there is no database server to fetch.)

An earlier version of this file said `npm ci && node scripts/fetch-postgres.mjs`,
which was two of the four steps then, and the first run in that account duly failed
`adif-reference` with *"the definitions are missing… Run: make setup"*. The
suite said exactly what to do; the instructions here were the thing that was
wrong.

**Expect a Keychain prompt on the first credential suite.** A binary that has
not written to that account's keychain before has no access to the items it
creates, so macOS asks once. Allow it — it is that account's own keychain and
holds nothing of yours.

## Setting it up from scratch

Done once, from the developing account:

```
git clone <working repo> /Users/Shared/qg-desktop-verify
chmod -R a+rwX /Users/Shared/qg-desktop-verify
cp -a ~/.rustup /Users/Shared/rust/rustup
cp -a ~/.cargo  /Users/Shared/rust/cargo
chmod -R a+rwX /Users/Shared/rust
```

Then once, signed in as the verification account:

```
git config --global --add safe.directory /Users/Shared/qg-desktop-verify
```

The checkout belongs to the developing account, and git refuses to read a
repository owned by another user. Without this line every report this account
writes says `unknown-commit` instead of the commit it covers, and a sign-off
recorded against it cannot name what it signed. `chmod` does not help: it is an
ownership check, not a permission one.

The toolchain is **copied, not downloaded**, so the version is identical to the
one the developing account builds with rather than whatever is current.
Verified afterwards with `cargo --version` from the shared path.

## What this does not cover

A suite run from the developing account still writes to that account's login
keychain — under this product's own test service, swept on exit, never beside a
real credential (`QGD-CRD-0013`). That is the safety net for day-to-day runs.
The account boundary is what makes the claim unconditional, so a release's
verification run belongs here.
