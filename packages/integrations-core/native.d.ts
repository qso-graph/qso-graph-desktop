// SPDX-License-Identifier: GPL-3.0-only
// The shape of Integrations' native listener as napi-rs exposes it
// (packages/integrations-core/src/lib.rs). Without this the addon arrives as
// `any`, and the one process that listens would call into it unchecked.
export interface NativeOpenOptions {
  port: number;
  addresses: string[];
  allow: string[];
  maxBytes: number;
  perSecond: number;
  burst: number;
  queue: number;
  repliesPerMinute: number;
}

export interface NativeDatagram {
  // The sender, as address:port ([v6]:port for IPv6).
  from: string;
  bytes: Uint8Array;
}

export interface NativeStats {
  received: number;
  dropped: { reason: 'not-allowed' | 'too-large' | 'over-rate' | 'queue-full'; count: number }[];
  // Each allowed sender's address and when it was last heard, in ms since the epoch.
  heard: { address: string; at: number }[];
}

export interface NativeListener {
  // The addresses and port actually bound.
  readonly bound: string[];
  next(max: number, timeoutMs: number): Promise<NativeDatagram[]>;
  // Throws with a fixed word: not-heard, too-large, over-rate, closed, failed, address.
  reply(to: string, bytes: Uint8Array): void;
  stats(): NativeStats;
  close(): void;
}

export interface NativeIntegrations {
  // Throws with a fixed word: port, limits, address, no-address, not-bound.
  open(options: NativeOpenOptions): NativeListener;
}
