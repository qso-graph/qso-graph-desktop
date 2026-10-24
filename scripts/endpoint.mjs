// SPDX-License-Identifier: GPL-3.0-only
// Deciding whether a socket represents a connection leaving this machine.
//
// Extracted and tested because the first version got it wrong in a way that
// only showed up occasionally: it treated any address that was not loopback as
// external, and Chromium's network service opens a UDP socket bound to `*:*`
// — no port, no peer, no connection — whenever it feels like it. Calling that
// an external connection made connection-capture fail at random.
//
// Loosening the rule to make a test pass is the wrong move if it hides
// something, so the distinction is drawn where it actually lies: a socket with
// a peer, and a socket listening on an address the outside world can reach,
// are both findings. A socket bound to nothing is not.

const LOOPBACK = /^(127\.0\.0\.1|\[?::1\]?|localhost)$/;
const WILDCARD = /^(\*|0\.0\.0\.0|\[?::\]?)$/;

export const host = endpoint => String(endpoint ?? '').replace(/:[^:]*$/, '').replace(/^\[|\]$/g, '');
export const port = endpoint => String(endpoint ?? '').split(':').pop();

// kind: 'connected' | 'listening' | 'unbound'
export function classify(endpoint) {
  const local = String(endpoint.local ?? '');
  const remote = String(endpoint.remote ?? '');

  if (remote) {
    // A peer. External unless that peer is this machine.
    return { kind: 'connected', external: !LOOPBACK.test(host(remote)) };
  }

  const localHost = host(local);
  const localPort = port(local);

  // No peer and no port: bound to nothing. Chromium's resolver does this.
  if (!localPort || localPort === '*') return { kind: 'unbound', external: false };

  // No peer but a port: something could reach it. A wildcard host means every
  // interface, which is reachable from outside; loopback is not.
  return { kind: 'listening', external: WILDCARD.test(localHost) || !LOOPBACK.test(localHost) };
}
