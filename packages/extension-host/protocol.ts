// SPDX-License-Identifier: GPL-3.0-only
// The messages between the broker and the extension host, and on each
// extension's own channel (QGD-APP-0015, QGD-APP-0018, QGD-APP-0021).
//
// Two kinds of link. The host link carries lifecycle only: load, activate,
// deactivate and the heartbeat. Each extension's channel carries that
// extension's requests and the core's card requests, and nothing else, so
// what arrives on it is that extension's and no one else's.

// Broker to host.
export type ToHost =
  // `entry` is a path the core built from the package and a validated
  // manifest, never one an extension supplied. The channel arrives with it.
  | { readonly type: 'load'; readonly id: string; readonly entry: string; readonly cards: readonly string[] }
  | { readonly type: 'activate'; readonly id: string; readonly seq: number }
  | { readonly type: 'deactivate'; readonly id: string; readonly seq: number }
  | { readonly type: 'ping'; readonly n: number };

// Host to broker.
export type FromHost =
  | { readonly type: 'activated'; readonly id: string; readonly seq: number; readonly ok: boolean; readonly error?: string }
  | { readonly type: 'deactivated'; readonly id: string; readonly seq: number }
  | { readonly type: 'pong'; readonly n: number }
  | { readonly type: 'log'; readonly level: 'info' | 'warn'; readonly id?: string; readonly msg: string };

// On an extension's channel, extension to broker.
export type FromExtension =
  | { readonly type: 'request'; readonly cid: number; readonly request: unknown }
  | { readonly type: 'card-answer'; readonly cid: number; readonly answer: unknown }
  // The provider stopped without answering: confirmed not to have taken
  // effect (QGD-APP-0021).
  | { readonly type: 'card-cancelled'; readonly cid: number };

// On an extension's channel, broker to extension.
export type ToExtension =
  | { readonly type: 'reply'; readonly cid: number; readonly reply: unknown }
  | { readonly type: 'card'; readonly cid: number; readonly cardId: string }
  | { readonly type: 'card-cancel'; readonly cid: number };

// One end of a message channel, whichever kind: Electron's MessagePortMain in
// the application, Node's MessagePort in the tests. Adapted at the edge so
// neither side of the protocol knows which.
export interface Port {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isCid = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

// What the broker accepts from an extension's channel, checked whole: the
// channel is the extension's, and an extension is not trusted to send well-
// formed messages (QGD-SEC-0006).
export function parseFromExtension(value: unknown): FromExtension | undefined {
  if (!isRecord(value) || !isCid(value.cid)) return undefined;
  const keys = Object.keys(value).sort().join(',');
  if (value.type === 'request' && keys === 'cid,request,type') return value as FromExtension;
  if (value.type === 'card-answer' && keys === 'answer,cid,type') return value as FromExtension;
  if (value.type === 'card-cancelled' && keys === 'cid,type') return value as FromExtension;
  return undefined;
}

export function parseFromHost(value: unknown): FromHost | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.type) {
    case 'activated':
      return typeof value.id === 'string' && Number.isSafeInteger(value.seq) && typeof value.ok === 'boolean'
        && (value.error === undefined || typeof value.error === 'string') ? value as FromHost : undefined;
    case 'deactivated':
      return typeof value.id === 'string' && Number.isSafeInteger(value.seq) ? value as FromHost : undefined;
    case 'pong':
      return Number.isSafeInteger(value.n) ? value as FromHost : undefined;
    case 'log':
      return (value.level === 'info' || value.level === 'warn') && typeof value.msg === 'string'
        && (value.id === undefined || typeof value.id === 'string') ? value as FromHost : undefined;
    default:
      return undefined;
  }
}
