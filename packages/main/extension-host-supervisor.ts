// SPDX-License-Identifier: GPL-3.0-only
// The broker's side of the extension host (QGD-APP-0015, QGD-APP-0018,
// QGD-APP-0020 to QGD-APP-0023).
//
// No Electron here: the host is reached through a HostLink and each
// extension through a Port, so that every path below runs under unit tests
// with the real host runtime in process. extension-broker.ts supplies the
// Electron versions (a utility process, MessageChannelMain).
//
// What this file owns:
// - identity: one channel per extension, made here and bound here, and every
//   request attributed by the channel it came in on (QGD-APP-0018);
// - the lifecycle: lazy start, one activation at a time, failure marked and
//   not retried until re-enabled or the host restarts (QGD-APP-0020);
// - the outcome of everything it asks an extension: completed, cancelled
//   (confirmed) or unknown, with late and duplicate replies discarded
//   (QGD-APP-0021);
// - supervision: a heartbeat watchdog, restarts that back off and stop at a
//   budget, and generations, so nothing from a replaced host is believed
//   (QGD-APP-0022).
import type { ExtensionReply } from '../extension-api/api-contract.js';
import { validateCardAnswer, type CardAnswer } from '../extension-api/cards.js';
import { parseFromExtension, parseFromHost, type Port, type ToHost } from '../extension-host/protocol.js';
import type { ExtensionLimits } from './extension-limits.js';

export interface HostLink {
  post(message: ToHost, transfer?: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

// A fresh channel: the broker's end, and the other end in whatever form the
// HostLink transfers.
export interface ChannelPair {
  readonly broker: Port;
  readonly transfer: unknown;
}

export interface SupervisorDeps {
  readonly limits: ExtensionLimits;
  spawn(): HostLink;
  channel(): ChannelPair;
  // What the core knows about an extension it may run: built from the package
  // and the validated manifest, never from the extension (QGD-APP-0017).
  describe(id: string): { readonly entry: string; readonly cards: readonly string[] } | undefined;
  // The request, served by the grant-checked path (extension-serve.ts) under
  // the identity this file bound to the channel.
  serve(id: string, request: unknown): Promise<ExtensionReply>;
  readonly log: {
    info(fields: Record<string, unknown>, message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
  };
}

export type CardOutcome =
  | { readonly outcome: 'completed'; readonly answer: CardAnswer }
  | { readonly outcome: 'cancelled' }
  | { readonly outcome: 'unknown'; readonly reason: string };

export type HostState = 'not started' | 'running' | 'restarting' | 'stopped';

export interface SupervisorStatus {
  readonly host: HostState;
  readonly failed: Readonly<Record<string, string>>;
  // The extensions the last host stop affected (QGD-APP-0022). Which one
  // caused it is not claimed.
  readonly affected: readonly string[];
}

// Fixed words, so nothing an extension sent reaches the screen or the log.
const SAID = {
  late: 'The extension did not answer in time.',
  stopped: 'The extension host stopped.',
  stoppedRepeatedly: 'The extension host stopped repeatedly and was not restarted.',
  activateFailed: 'This extension could not start.',
  activateLate: 'This extension did not start in time.',
  disabled: 'This extension is turned off.',
  unknownExtension: 'That is not an extension this core runs.',
  unshowable: 'This card sent data that cannot be shown.',
  tooLarge: 'That request is larger than an extension may send.',
  tooMany: 'This extension has too many requests waiting.'
} as const;

interface Generation {
  readonly n: number;
  readonly link: HostLink;
  readonly channels: Map<string, Port>;
  readonly activations: Map<number, { id: string; settle: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }>;
  readonly deactivations: Map<number, { settle: () => void; timer: ReturnType<typeof setTimeout> }>;
  readonly cards: Map<string, { settle: (outcome: CardOutcome) => void; timer: ReturnType<typeof setTimeout> }>;
  readonly inFlight: Map<string, number>;
  missed: number;
  ping: number;
  heartbeat?: ReturnType<typeof setInterval>;
  dead: boolean;
}

export function createSupervisor(deps: SupervisorDeps) {
  const { limits } = deps;
  let state: HostState = 'not started';
  let current: Generation | undefined;
  let generations = 0;
  let seq = 0;
  let cardCid = 0;
  const active = new Set<string>();
  const activating = new Map<string, Promise<{ ok: true } | { ok: false; reason: string }>>();
  const failed = new Map<string, string>();
  const disabled = new Set<string>();
  const restarts: number[] = [];
  let affected: string[] = [];
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(status: SupervisorStatus) => void>();

  const status = (): SupervisorStatus => ({ host: state, failed: Object.fromEntries(failed), affected: [...affected] });
  const changed = () => { const now = status(); for (const listener of listeners) listener(now); };

  function spawn(): Generation {
    const link = deps.spawn();
    const generation: Generation = {
      n: ++generations, link, channels: new Map(), activations: new Map(), deactivations: new Map(),
      cards: new Map(), inFlight: new Map(), missed: 0, ping: 0, dead: false
    };
    link.onMessage(raw => onHost(generation, raw));
    link.onExit(() => { if (!generation.dead) lost(generation, SAID.stopped); });
    generation.heartbeat = setInterval(() => {
      if (generation.dead) return;
      if (generation.missed >= limits.heartbeatMisses) { lost(generation, 'stopped answering'); return; }
      generation.missed += 1;
      link.post({ type: 'ping', n: ++generation.ping });
    }, limits.heartbeatMs);
    current = generation;
    state = 'running';
    deps.log.info({ generation: generation.n }, 'extension host started');
    changed();
    return generation;
  }

  function onHost(generation: Generation, raw: unknown): void {
    // A replaced host is not believed (QGD-APP-0022).
    if (generation.dead || generation !== current) return;
    const message = parseFromHost(raw);
    if (!message) return;
    switch (message.type) {
      case 'pong': generation.missed = 0; return;
      case 'log':
        deps.log[message.level]({ extension: message.id }, message.msg);
        return;
      case 'activated': {
        const waiting = generation.activations.get(message.seq);
        if (!waiting || waiting.id !== message.id) return;
        generation.activations.delete(message.seq);
        clearTimeout(waiting.timer);
        waiting.settle(message.ok);
        return;
      }
      case 'deactivated': {
        const waiting = generation.deactivations.get(message.seq);
        if (!waiting) return;
        generation.deactivations.delete(message.seq);
        clearTimeout(waiting.timer);
        waiting.settle();
        return;
      }
    }
  }

  // An extension's channel, made and bound here: whatever arrives on it is
  // this extension's (QGD-APP-0018).
  function bind(generation: Generation, id: string): Port | undefined {
    const known = generation.channels.get(id);
    if (known) return known;
    const description = deps.describe(id);
    if (!description) return undefined;
    const pair = deps.channel();
    generation.channels.set(id, pair.broker);
    pair.broker.onMessage(raw => onChannel(generation, id, pair.broker, raw));
    generation.link.post({ type: 'load', id, entry: description.entry, cards: [...description.cards] }, pair.transfer);
    return pair.broker;
  }

  function onChannel(generation: Generation, id: string, port: Port, raw: unknown): void {
    if (generation.dead || generation !== current) return;
    const message = parseFromExtension(raw);
    if (!message) return;
    if (message.type === 'request') {
      const reply = (value: ExtensionReply) => { if (!generation.dead) port.post({ type: 'reply', cid: message.cid, reply: value }); };
      let size: number;
      // Bytes, not characters: a character can be four bytes in UTF-8.
      try { size = Buffer.byteLength(JSON.stringify(message.request) ?? '', 'utf8'); } catch { size = Infinity; }
      if (size > limits.messageBytes) { reply({ ok: false, error: SAID.tooLarge }); return; }
      const waiting = generation.inFlight.get(id) ?? 0;
      if (waiting >= limits.inFlight) { reply({ ok: false, error: SAID.tooMany }); return; }
      generation.inFlight.set(id, waiting + 1);
      const kind = (message.request as { kind?: unknown } | null)?.kind;
      const deadline = kind === 'source.fetch' ? limits.sourceFetchDeadlineMs : limits.requestDeadlineMs;
      // The slot is held until the work ends, not until the deadline: a
      // request answered late is still running, and still counts.
      let replied = false;
      const timer = setTimeout(() => { if (!replied) { replied = true; reply({ ok: false, error: SAID.late }); } }, deadline);
      const release = () => generation.inFlight.set(id, Math.max(0, (generation.inFlight.get(id) ?? 1) - 1));
      deps.serve(id, message.request).then(
        value => { clearTimeout(timer); release(); if (!replied) { replied = true; reply(value); } },
        () => { clearTimeout(timer); release(); if (!replied) { replied = true; reply({ ok: false, error: 'That could not be done.' }); } });
      return;
    }
    // A card answer or a confirmed cancellation. One per request: the first
    // settles it, and anything after is discarded (QGD-APP-0021).
    const key = `${id}#${message.cid}`;
    const waiting = generation.cards.get(key);
    if (!waiting) return;
    generation.cards.delete(key);
    clearTimeout(waiting.timer);
    if (message.type === 'card-cancelled') { waiting.settle({ outcome: 'cancelled' }); return; }
    try {
      waiting.settle({ outcome: 'completed', answer: validateCardAnswer(message.answer) });
    } catch {
      deps.log.warn({ extension: id }, 'a card answer was refused');
      waiting.settle({ outcome: 'completed', answer: { ok: false, reason: SAID.unshowable } });
    }
  }

  // The host stopped, by exit or by the watchdog.
  function lost(generation: Generation, why: string): void {
    if (generation.dead) return;
    generation.dead = true;
    if (generation.heartbeat) clearInterval(generation.heartbeat);
    try { generation.link.kill(); } catch { /* already gone */ }
    for (const port of generation.channels.values()) { try { port.close(); } catch { /* closed */ } }
    for (const waiting of generation.activations.values()) { clearTimeout(waiting.timer); waiting.settle(false); }
    for (const waiting of generation.deactivations.values()) { clearTimeout(waiting.timer); waiting.settle(); }
    for (const waiting of generation.cards.values()) { clearTimeout(waiting.timer); waiting.settle({ outcome: 'unknown', reason: SAID.stopped }); }
    generation.activations.clear(); generation.deactivations.clear(); generation.cards.clear();
    affected = [...active].sort();
    const wanted = [...active];
    active.clear();
    if (current === generation) current = undefined;
    deps.log.warn({ generation: generation.n, why, affected }, 'extension host stopped');

    const now = Date.now();
    while (restarts.length > 0 && now - restarts[0] > limits.restartWindowMs) restarts.shift();
    if (restarts.length >= limits.restartBudget) {
      state = 'stopped';
      for (const id of wanted) failed.set(id, SAID.stoppedRepeatedly);
      deps.log.warn({ restarts: restarts.length }, 'extension host not restarted: restart budget spent');
      changed();
      return;
    }
    restarts.push(now);
    state = 'restarting';
    // A failure is not retried until the host restarts; this is that restart.
    failed.clear();
    changed();
    const wait = Math.min(500 * 2 ** (restarts.length - 1), 30_000);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (state !== 'restarting') return;
      spawn();
      for (const id of wanted) if (!disabled.has(id)) void ensureActive(id);
    }, wait);
  }

  function ensureActive(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (disabled.has(id)) return Promise.resolve({ ok: false, reason: SAID.disabled });
    if (!deps.describe(id)) return Promise.resolve({ ok: false, reason: SAID.unknownExtension });
    const failure = failed.get(id);
    if (failure) return Promise.resolve({ ok: false, reason: failure });
    if (state === 'stopped') return Promise.resolve({ ok: false, reason: SAID.stoppedRepeatedly });
    if (active.has(id) && current) return Promise.resolve({ ok: true });
    // Concurrent reasons to activate become one activation (QGD-APP-0020).
    const running = activating.get(id);
    if (running) return running;
    const attempt = (async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
      // Lazy: the host starts when the first extension is needed, never with
      // the window (QGD-APP-0023).
      const generation = current ?? (state === 'restarting' ? undefined : spawn());
      if (!generation) return { ok: false, reason: SAID.stopped };
      if (!bind(generation, id)) return { ok: false, reason: SAID.unknownExtension };
      const n = ++seq;
      const result = await new Promise<'ok' | 'failed' | 'late'>(settle => {
        const timer = setTimeout(() => { generation.activations.delete(n); settle('late'); }, limits.activateDeadlineMs);
        generation.activations.set(n, { id, timer, settle: ok => settle(ok ? 'ok' : 'failed') });
        generation.link.post({ type: 'activate', id, seq: n });
      });
      if (result === 'ok' && !generation.dead) {
        active.add(id);
        // Turned off while it was starting: the off wins (QGD-APP-0020).
        if (disabled.has(id)) { await deactivate(id); return { ok: false, reason: SAID.disabled }; }
        return { ok: true };
      }
      if (generation.dead) return { ok: false, reason: SAID.stopped };
      const reason = result === 'late' ? SAID.activateLate : SAID.activateFailed;
      failed.set(id, reason);
      deps.log.warn({ extension: id, result }, 'extension did not activate');
      changed();
      return { ok: false, reason };
    })();
    activating.set(id, attempt);
    void attempt.finally(() => activating.delete(id));
    return attempt;
  }

  async function deactivate(id: string): Promise<void> {
    const generation = current;
    if (!generation || !active.has(id)) { active.delete(id); return; }
    active.delete(id);
    const n = ++seq;
    const overran = await new Promise<boolean>(settle => {
      const timer = setTimeout(() => { generation.deactivations.delete(n); settle(true); }, limits.deactivateDeadlineMs);
      generation.deactivations.set(n, { timer, settle: () => settle(false) });
      generation.link.post({ type: 'deactivate', id, seq: n });
    });
    // An overrun stops the host, which affects every extension in it, and is
    // reported that way (QGD-APP-0020, QGD-APP-0022).
    if (overran && !generation.dead) lost(generation, `deactivation of ${id} overran`);
  }

  // Ask an extension for a card's data. The core decides when (QGD-HOM-0005);
  // `signal` asks the extension to stop, which only it can confirm.
  async function card(id: string, cardId: string, signal?: AbortSignal): Promise<CardOutcome> {
    // Cancelled before it was sent: nothing happened, so that is confirmed.
    if (signal?.aborted) return { outcome: 'cancelled' };
    const ready = await ensureActive(id);
    if (signal?.aborted) return { outcome: 'cancelled' };
    if (!ready.ok) return { outcome: 'completed', answer: { ok: false, reason: ready.reason } };
    const generation = current;
    const port = generation?.channels.get(id);
    if (!generation || !port) return { outcome: 'unknown', reason: SAID.stopped };
    const cid = ++cardCid;
    const key = `${id}#${cid}`;
    return new Promise<CardOutcome>(resolve => {
      const onAbort = () => { if (generation.cards.has(key)) port.post({ type: 'card-cancel', cid }); };
      // The listener goes when the card settles, so a long-lived signal does
      // not collect one per card.
      const settle = (outcome: CardOutcome) => { signal?.removeEventListener('abort', onAbort); resolve(outcome); };
      const timer = setTimeout(() => {
        // Past its deadline the answer is unknown, and a reply that comes
        // later is discarded because the key is gone (QGD-APP-0021).
        generation.cards.delete(key);
        port.post({ type: 'card-cancel', cid });
        settle({ outcome: 'unknown', reason: SAID.late });
      }, limits.requestDeadlineMs);
      generation.cards.set(key, { settle, timer });
      signal?.addEventListener('abort', onAbort, { once: true });
      port.post({ type: 'card', cid, cardId });
    });
  }

  return {
    ensureActive,
    card,
    async setEnabled(id: string, enabled: boolean): Promise<void> {
      if (enabled) { disabled.delete(id); failed.delete(id); changed(); return; }
      disabled.add(id);
      // An activation already under way finishes first, sees the extension
      // is off, and deactivates it itself; then this one has nothing to do.
      await activating.get(id);
      // Turned back on while it waited: the later intent wins.
      if (!disabled.has(id)) return;
      await deactivate(id);
      changed();
    },
    status,
    onChange(listener: (status: SupervisorStatus) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop(): void {
      state = 'stopped';
      if (restartTimer) clearTimeout(restartTimer);
      if (current) {
        const generation = current;
        generation.dead = true;
        if (generation.heartbeat) clearInterval(generation.heartbeat);
        for (const port of generation.channels.values()) { try { port.close(); } catch { /* closed */ } }
        for (const waiting of generation.cards.values()) { clearTimeout(waiting.timer); waiting.settle({ outcome: 'unknown', reason: SAID.stopped }); }
        try { generation.link.kill(); } catch { /* gone */ }
        current = undefined;
      }
    }
  };
}

export type Supervisor = ReturnType<typeof createSupervisor>;
