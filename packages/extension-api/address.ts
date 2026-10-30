// SPDX-License-Identifier: GPL-3.0-only
// The shape of an address and of a sender as Integrations names them
// (QGD-INT-0006): IPv4 dotted, or IPv6 in hex and colons; a sender is one of
// those with its port, the IPv6 one in brackets. Shape only: the listener
// parses an address and refuses what does not parse.
//
// Split, then matched by flat patterns, rather than one pattern with a
// repeated group, which the security lint rightly reads as able to backtrack
// (QGD-SEC-0013). No dependencies (QGD-REP-0006).
const OCTET = /^\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:.]{2,45}$/;
const PORT = /^\d{1,5}$/;

export function isIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => OCTET.test(part) && Number(part) <= 255);
}

// IPv6, with an IPv4 tail allowed (::ffff:192.0.2.1).
export function isIPv6(value: string): boolean {
  return value.includes(':') && IPV6.test(value);
}

export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && (isIPv4(value) || isIPv6(value));
}

// address:port, or [IPv6]:port.
export function isSender(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const at = value.lastIndexOf(':');
  if (at <= 0) return false;
  const host = value.slice(0, at);
  const port = value.slice(at + 1);
  if (!PORT.test(port) || Number(port) > 65_535) return false;
  if (host.startsWith('[') && host.endsWith(']')) return isIPv6(host.slice(1, -1));
  return isIPv4(host);
}
