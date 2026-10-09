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
npm ci
node scripts/fetch-postgres.mjs      # the pinned build, ~200 MB (QGD-ENG-0004)
```

Both write inside the checkout. Neither needs a credential.

## Setting it up from scratch

Done once, from the developing account:

```
git clone <working repo> /Users/Shared/qg-desktop-verify
chmod -R a+rwX /Users/Shared/qg-desktop-verify
cp -a ~/.rustup /Users/Shared/rust/rustup
cp -a ~/.cargo  /Users/Shared/rust/cargo
chmod -R a+rwX /Users/Shared/rust
```

The toolchain is **copied, not downloaded**, so the version is identical to the
one the developing account builds with rather than whatever is current.
Verified afterwards with `cargo --version` from the shared path.

## What this does not cover

A suite run from the developing account still writes to that account's login
keychain — under this product's own test service, swept on exit, never beside a
real credential (`QGD-CRD-0013`). That is the safety net for day-to-day runs.
The account boundary is what makes the claim unconditional, so a release's
verification run belongs here.
