// SPDX-License-Identifier: GPL-3.0-only
// One unit of work at a time on a connection (QGD-ENG-0020).
//
// node:sqlite is synchronous, but Drizzle's sqlite-proxy is not. Its
// transaction() awaits between statements, so a second request arriving in
// that gap runs inside the first request's open transaction. If the first then
// rolls back, the second's write goes with it, although the second request
// succeeded. So every request runs as one unit, holding the connection from its
// first statement to its last, and the next unit starts only when it is done,
// whether it succeeded or failed.
export class UnitQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(unit: () => Promise<T> | T): Promise<T> {
    const result = this.#tail.then(() => unit());
    // The chain continues past a failure. The failure is the caller's to
    // handle; it is not the next unit's.
    this.#tail = result.catch(() => undefined);
    return result;
  }
}
