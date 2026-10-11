// SPDX-License-Identifier: GPL-3.0-only
// The extension host's runtime (QGD-APP-0015, QGD-APP-0020): what runs
// inside QG Extensions, written with no Electron in it so that every path
// through it can be tested in process. host.ts is the Electron wiring.
//
// The host is trusted code that runs trusted code (QGD-APP-0016). What it
// guarantees is the lifecycle and the channel discipline, not containment:
// each extension speaks on its own channel, which the broker bound to it, and
// the host never relays one extension's message on another's channel.
import type { ExtensionReply, ExtensionRequest } from '../extension-api/api-contract.js';
import type { CardAnswer } from '../extension-api/cards.js';
import type { CardProvider, Disposable, ExtensionContext, ExtensionModule } from '../extension-api/context.js';
import type { FromHost, Port, ToExtension } from './protocol.js';
import { plainRequest } from '../extension-api/plain.js';

interface Loaded {
  readonly id: string;
  readonly entry: string;
  readonly cards: ReadonlySet<string>;
  readonly port: Port;
  module?: ExtensionModule;
  active: boolean;
  subscriptions: Disposable[];
  readonly providers: Map<string, CardProvider>;
  readonly waiting: Map<number, { resolve: (reply: ExtensionReply) => void; reject: (error: Error) => void }>;
  readonly cardWork: Map<number, AbortController>;
  nextCid: number;
  // Activation and deactivation, one after another (QGD-APP-0020): a
  // deactivation still finishing must not tear down the activation after it.
  lifecycle: Promise<void>;
}

export interface HostRuntimeOptions {
  // Loads an extension's main module. Given only paths the core built.
  importModule: (entry: string) => Promise<unknown>;
  toBroker: (message: FromHost) => void;
}

// Text a card may carry when its provider failed. Fixed, so nothing the
// extension threw reaches the screen or the log (QGD-ENG-0016).
const PROVIDER_FAILED = 'This card could not be made just now.';
const NOT_PROVIDED = 'This card has no provider.';

export function createHostRuntime(options: HostRuntimeOptions) {
  const extensions = new Map<string, Loaded>();

  const log = (level: 'info' | 'warn', msg: string, id?: string) =>
    options.toBroker({ type: 'log', level, msg, ...(id ? { id } : {}) });

  function contextFor(extension: Loaded): ExtensionContext {
    return {
      extensionId: extension.id,
      request(request: ExtensionRequest, opts?: { signal?: AbortSignal }): Promise<ExtensionReply> {
        const cid = extension.nextCid++;
        return new Promise<ExtensionReply>((resolve, reject) => {
          const signal = opts?.signal;
          if (signal?.aborted) { reject(new Error('The request was cancelled before it was sent.')); return; }
          // Cancelled here; the broker still finishes and replies, and that
          // reply is dropped. For a read that is all cancellation means.
          const onAbort = () => { if (extension.waiting.delete(cid)) reject(new Error('The request was cancelled.')); };
          extension.waiting.set(cid, {
            resolve: reply => { signal?.removeEventListener('abort', onAbort); resolve(reply); },
            reject: error => { signal?.removeEventListener('abort', onAbort); reject(error); }
          });
          signal?.addEventListener('abort', onAbort, { once: true });
          let plain: unknown;
          try { plain = plainRequest(request); } catch { plain = request; }
          extension.port.post({ type: 'request', cid, request: plain });
        });
      },
      cards: {
        register(cardId: string, provider: CardProvider): Disposable {
          if (!extension.cards.has(cardId)) throw new Error(`"${cardId}" is not a card this extension contributes.`);
          if (typeof provider !== 'function') throw new Error('A card provider is a function.');
          extension.providers.set(cardId, provider);
          return { dispose: () => { if (extension.providers.get(cardId) === provider) extension.providers.delete(cardId); } };
        }
      },
      subscriptions: extension.subscriptions
    };
  }

  async function provideCard(extension: Loaded, cid: number, cardId: string): Promise<void> {
    const provider = extension.active ? extension.providers.get(cardId) : undefined;
    if (!provider) {
      extension.port.post({ type: 'card-answer', cid, answer: { ok: false, reason: NOT_PROVIDED } satisfies CardAnswer });
      return;
    }
    const work = new AbortController();
    extension.cardWork.set(cid, work);
    let answer: unknown;
    try {
      answer = await provider({ cardId, signal: work.signal });
    } catch {
      answer = work.signal.aborted ? undefined : { ok: false, reason: PROVIDER_FAILED };
      if (!work.signal.aborted) log('warn', 'a card provider failed', extension.id);
    } finally {
      extension.cardWork.delete(cid);
    }
    // Cancelled and stopped without answering: confirmed not to have taken
    // effect (QGD-APP-0021). An answer that arrives anyway is still sent;
    // the broker decides whether it is wanted.
    if (answer === undefined && work.signal.aborted) extension.port.post({ type: 'card-cancelled', cid });
    else extension.port.post({ type: 'card-answer', cid, answer });
  }

  function onChannel(extension: Loaded, raw: unknown): void {
    const message = raw as ToExtension;
    if (typeof message !== 'object' || message === null) return;
    if (message.type === 'reply') {
      const waiting = extension.waiting.get(message.cid);
      if (!waiting) return;
      extension.waiting.delete(message.cid);
      waiting.resolve(message.reply as ExtensionReply);
    } else if (message.type === 'card' && typeof message.cardId === 'string' && Number.isSafeInteger(message.cid)) {
      void provideCard(extension, message.cid, message.cardId);
    } else if (message.type === 'card-cancel') {
      extension.cardWork.get(message.cid)?.abort();
    }
  }

  function dispose(extension: Loaded): void {
    for (const subscription of extension.subscriptions.splice(0)) {
      try { subscription.dispose(); } catch { /* the rest are still disposed */ }
    }
    extension.providers.clear();
  }

  // Queued per extension, so lifecycle steps never overlap.
  function queue(id: string, step: () => Promise<void>, unknown: () => void): void {
    const extension = extensions.get(id);
    if (!extension) { unknown(); return; }
    extension.lifecycle = extension.lifecycle.then(step, step);
  }

  async function activate(id: string, seq: number): Promise<void> {
    const extension = extensions.get(id);
    if (!extension) { options.toBroker({ type: 'activated', id, seq, ok: false, error: 'not loaded' }); return; }
    if (extension.active) { options.toBroker({ type: 'activated', id, seq, ok: true }); return; }
    try {
      const loaded = (extension.module ??= await options.importModule(extension.entry) as ExtensionModule);
      if (typeof loaded?.activate !== 'function') throw new Error('no activate function');
      extension.subscriptions = [];
      await loaded.activate(contextFor(extension));
      extension.active = true;
      options.toBroker({ type: 'activated', id, seq, ok: true });
    } catch {
      // What it registered before failing goes with it, so a retry starts clean.
      dispose(extension);
      // The extension's own message is not passed on: it is the extension's
      // text, and the operator is told in the core's words (QGD-ENG-0016).
      log('warn', 'activation failed', id);
      options.toBroker({ type: 'activated', id, seq, ok: false, error: 'activation failed' });
    }
  }

  async function deactivate(id: string, seq: number): Promise<void> {
    const extension = extensions.get(id);
    if (extension?.active) {
      extension.active = false;
      for (const work of extension.cardWork.values()) work.abort();
      try { await extension.module?.deactivate?.(); } catch { log('warn', 'deactivate failed', id); }
      dispose(extension);
    }
    options.toBroker({ type: 'deactivated', id, seq });
  }

  return {
    // A message from the broker, with the extension's channel when it is a load.
    receive(raw: unknown, port?: Port): void {
      const message = raw as { type?: unknown; id?: unknown; seq?: unknown; n?: unknown; entry?: unknown; cards?: unknown };
      if (typeof message !== 'object' || message === null) return;
      if (message.type === 'ping' && Number.isSafeInteger(message.n)) {
        options.toBroker({ type: 'pong', n: message.n as number });
      } else if (message.type === 'load' && typeof message.id === 'string' && typeof message.entry === 'string'
          && Array.isArray(message.cards) && port) {
        if (extensions.has(message.id)) return;
        const extension: Loaded = {
          id: message.id, entry: message.entry, cards: new Set(message.cards.filter((c): c is string => typeof c === 'string')),
          port, active: false, subscriptions: [], providers: new Map(), waiting: new Map(), cardWork: new Map(), nextCid: 1, lifecycle: Promise.resolve()
        };
        extensions.set(message.id, extension);
        port.onMessage(value => onChannel(extension, value));
      } else if (message.type === 'activate' && typeof message.id === 'string' && Number.isSafeInteger(message.seq)) {
        const id = message.id; const seq = message.seq as number;
        queue(id, () => activate(id, seq), () => options.toBroker({ type: 'activated', id, seq, ok: false, error: 'not loaded' }));
      } else if (message.type === 'deactivate' && typeof message.id === 'string' && Number.isSafeInteger(message.seq)) {
        const id = message.id; const seq = message.seq as number;
        queue(id, () => deactivate(id, seq), () => options.toBroker({ type: 'deactivated', id, seq }));
      }
    }
  };
}
