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
import type { PageAnswer } from '../extension-api/pages.js';
import type { PageProvider, Disposable, ExtensionContext, ExtensionModule, Datagram } from '../extension-api/context.js';
import { validateDelivered, validateEvent, type DeliveredEvent, type IntegrationEvent } from '../extension-api/integration-events.js';
import type { FromHost, Port, ToExtension } from './protocol.js';
import { plainRequest } from '../extension-api/plain.js';

interface Loaded {
  readonly id: string;
  readonly entry: string;
  readonly pages: ReadonlySet<string>;
  readonly port: Port;
  module?: ExtensionModule;
  active: boolean;
  subscriptions: Disposable[];
  readonly providers: Map<string, PageProvider>;
  // Integrations' listeners, registered through the context (QGD-INT-0020,
  // QGD-INT-0021), and gone with its subscriptions.
  readonly datagramListeners: Set<(datagrams: readonly Datagram[]) => void>;
  readonly eventListeners: Set<(events: readonly DeliveredEvent[]) => void>;
  readonly waiting: Map<number, { resolve: (reply: ExtensionReply) => void; reject: (error: Error) => void }>;
  readonly pageWork: Map<number, AbortController>;
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

// Text a page may carry when its provider failed. Fixed, so nothing the
// extension threw reaches the screen or the log (QGD-ENG-0016).
const PROVIDER_FAILED = 'This page could not be made just now.';
const NOT_PROVIDED = 'This page has no provider.';

export function createHostRuntime(options: HostRuntimeOptions) {
  const extensions = new Map<string, Loaded>();

  const log = (level: 'info' | 'warn', msg: string, id?: string) =>
    options.toBroker({ type: 'log', level, msg, ...(id ? { id } : {}) });

  function listen<T>(set: Set<T>, listener: T): Disposable {
    if (typeof listener !== 'function') throw new Error('A listener is a function.');
    set.add(listener);
    return { dispose: () => { set.delete(listener); } };
  }

  // Each listener on its own: one that throws does not keep the rest from
  // hearing, and its text goes nowhere (QGD-ENG-0016).
  function tell<T>(extension: Loaded, set: Set<(value: T) => void>, value: T): void {
    for (const listener of [...set]) {
      try { listener(value); } catch { log('warn', 'a listener failed', extension.id); }
    }
  }

  function contextFor(extension: Loaded): ExtensionContext {
    const context: ExtensionContext = {
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
      pages: {
        register(pageId: string, provider: PageProvider): Disposable {
          if (!extension.pages.has(pageId)) throw new Error(`"${pageId}" is not a page this extension contributes.`);
          if (typeof provider !== 'function') throw new Error('A page provider is a function.');
          extension.providers.set(pageId, provider);
          return { dispose: () => { if (extension.providers.get(pageId) === provider) extension.providers.delete(pageId); } };
        },
        changed(pageId: string): void {
          if (!extension.pages.has(pageId)) throw new Error(`"${pageId}" is not a page this extension contributes.`);
          // Said and not waited on: the core decides whether to ask.
          void context.request({ kind: 'page.changed', page: pageId }).catch(() => {});
        }
      },
      integration: {
        onDatagrams: listener => listen(extension.datagramListeners, listener),
        onEvents: listener => listen(extension.eventListeners, listener),
        // Each event checked here as the core will check it, so one field out
        // of its bounds costs that event, counted as malformed, rather than
        // the core refusing the whole batch (QGD-INT-0008).
        publish: (events, malformed = 0) => {
          const kept: IntegrationEvent[] = [];
          let dropped = malformed;
          for (const event of events) {
            try { kept.push(validateEvent(event)); } catch { dropped += 1; }
          }
          return context.request({ kind: 'integration.events', events: kept, ...(dropped > 0 ? { malformed: dropped } : {}) });
        },
        reply: (to, bytes) => context.request({ kind: 'integration.reply', to, bytes: Buffer.from(bytes).toString('base64') })
      },
      subscriptions: extension.subscriptions
    };
    return context;
  }

  async function providePage(extension: Loaded, cid: number, pageId: string, inputs: Readonly<Record<string, string>>, settings: Readonly<Record<string, string>> = {}): Promise<void> {
    const provider = extension.active ? extension.providers.get(pageId) : undefined;
    if (!provider) {
      extension.port.post({ type: 'page-answer', cid, answer: { ok: false, reason: NOT_PROVIDED } satisfies PageAnswer });
      return;
    }
    const work = new AbortController();
    extension.pageWork.set(cid, work);
    let answer: unknown;
    try {
      answer = await provider({ pageId, signal: work.signal, inputs: Object.freeze({ ...inputs }), settings: Object.freeze({ ...settings }) });
    } catch {
      answer = work.signal.aborted ? undefined : { ok: false, reason: PROVIDER_FAILED };
      if (!work.signal.aborted) log('warn', 'a page provider failed', extension.id);
    } finally {
      extension.pageWork.delete(cid);
    }
    // Cancelled and stopped without answering: confirmed not to have taken
    // effect (QGD-APP-0021). An answer that arrives anyway is still sent;
    // the broker decides whether it is wanted.
    if (answer === undefined && work.signal.aborted) extension.port.post({ type: 'page-cancelled', cid });
    else extension.port.post({ type: 'page-answer', cid, answer });
  }

  function onChannel(extension: Loaded, raw: unknown): void {
    const message = raw as ToExtension;
    if (typeof message !== 'object' || message === null) return;
    if (message.type === 'reply') {
      const waiting = extension.waiting.get(message.cid);
      if (!waiting) return;
      extension.waiting.delete(message.cid);
      waiting.resolve(message.reply as ExtensionReply);
    } else if (message.type === 'page' && typeof message.pageId === 'string' && Number.isSafeInteger(message.cid)) {
      // The core checked the fields; a message without them is a page with
      // none filled in.
      const inputs = typeof message.inputs === 'object' && message.inputs !== null && !Array.isArray(message.inputs)
        ? Object.fromEntries(Object.entries(message.inputs).filter(([, value]) => typeof value === 'string'))
        : {};
      const settings = typeof message.settings === 'object' && message.settings !== null && !Array.isArray(message.settings)
        ? Object.fromEntries(Object.entries(message.settings).filter(([, value]) => typeof value === 'string'))
        : {};
      void providePage(extension, message.cid, message.pageId, inputs, settings);
    } else if (message.type === 'page-cancel') {
      extension.pageWork.get(message.cid)?.abort();
    } else if (message.type === 'datagrams' && extension.active && Array.isArray(message.datagrams)) {
      const datagrams = (message.datagrams as readonly unknown[]).filter((entry): entry is Datagram => {
        const candidate = entry as { from?: unknown; bytes?: unknown } | null;
        return typeof candidate === 'object' && candidate !== null && typeof candidate.from === 'string' && candidate.bytes instanceof Uint8Array;
      });
      if (datagrams.length > 0) tell(extension, extension.datagramListeners, datagrams);
    } else if (message.type === 'events' && extension.active && Array.isArray(message.events)) {
      const events: DeliveredEvent[] = [];
      for (const entry of message.events) {
        try { events.push(validateDelivered(entry)); } catch { /* the core checked it; one that fails here is dropped */ }
      }
      if (events.length > 0) tell(extension, extension.eventListeners, events);
    }
  }

  function dispose(extension: Loaded): void {
    for (const subscription of extension.subscriptions.splice(0)) {
      try { subscription.dispose(); } catch { /* the rest are still disposed */ }
    }
    extension.providers.clear();
    extension.datagramListeners.clear();
    extension.eventListeners.clear();
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
      for (const work of extension.pageWork.values()) work.abort();
      try { await extension.module?.deactivate?.(); } catch { log('warn', 'deactivate failed', id); }
      dispose(extension);
    }
    options.toBroker({ type: 'deactivated', id, seq });
  }

  return {
    // A message from the broker, with the extension's channel when it is a load.
    receive(raw: unknown, port?: Port): void {
      const message = raw as { type?: unknown; id?: unknown; seq?: unknown; n?: unknown; entry?: unknown; pages?: unknown };
      if (typeof message !== 'object' || message === null) return;
      if (message.type === 'ping' && Number.isSafeInteger(message.n)) {
        options.toBroker({ type: 'pong', n: message.n as number });
      } else if (message.type === 'load' && typeof message.id === 'string' && typeof message.entry === 'string'
          && Array.isArray(message.pages) && port) {
        if (extensions.has(message.id)) return;
        const extension: Loaded = {
          id: message.id, entry: message.entry, pages: new Set(message.pages.filter((c): c is string => typeof c === 'string')),
          port, active: false, subscriptions: [], providers: new Map(), datagramListeners: new Set(), eventListeners: new Set(),
          waiting: new Map(), pageWork: new Map(), nextCid: 1, lifecycle: Promise.resolve()
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
