// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { classify } from '../scripts/endpoint.mjs';

const of = (local, remote = '') => classify({ local, remote });

describe('what counts as a connection leaving this machine', () => {
  it.each([
    ['93.184.216.34:443', 'a peer on the internet'],
    ['10.0.0.5:8080', 'a peer on the local network']
  ])('flags a socket with an external peer (%s — %s)', remote => {
    expect(of('192.168.1.10:51000', remote)).toEqual({ kind: 'connected', external: true });
  });

  it('does not flag a peer that is this machine', () => {
    expect(of('127.0.0.1:64231', '127.0.0.1:64232')).toEqual({ kind: 'connected', external: false });
    expect(of('[::1]:5000', '[::1]:5001')).toEqual({ kind: 'connected', external: false });
  });

  it.each([
    ['*:*', 'the unbound UDP socket Chromium opens'],
    ['*', 'no port at all']
  ])('does not flag a socket bound to nothing (%s — %s)', local => {
    expect(classify({ local, remote: '' })).toEqual({ kind: 'unbound', external: false });
  });

  it('does not flag a loopback listener, which is what the test harness uses', () => {
    expect(of('127.0.0.1:64231')).toEqual({ kind: 'listening', external: false });
  });

  it.each([
    ['*:8080', 'every interface'],
    ['0.0.0.0:8080', 'every interface, written out'],
    ['192.168.1.10:8080', 'a routable address']
  ])('flags a listener the outside world could reach (%s — %s)', local => {
    expect(classify({ local, remote: '' })).toEqual({ kind: 'listening', external: true });
  });

  it('still flags an external peer even when the local end is loopback', () => {
    // A proxy or a tunnel would look like this; it is still traffic leaving.
    expect(of('127.0.0.1:51000', '93.184.216.34:443').external).toBe(true);
  });
});
