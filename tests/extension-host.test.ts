// SPDX-License-Identifier: GPL-3.0-only
// P8-identity, P8-lifecycle, P8-messages, P8-supervision and P8-window, in
// process: the broker's supervisor and the real host runtime, connected over
// real MessageChannels, with timers the test controls (QGD-APP-0018,
// QGD-APP-0020 to QGD-APP-0023). The run in a real utility process is
// P8-host's, in the window suites.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { ExtensionModule } from '../packages/extension-api/context.js';
import type { CardAnswer } from '../packages/extension-api/cards.js';
import { createHostRuntime } from '../packages/extension-host/runtime.js';
import type { Port } from '../packages/extension-host/protocol.js';
import { createSupervisor, type HostLink, type SupervisorDeps } from '../packages/main/extension-host-supervisor.js';
import type { ExtensionLimits } from '../packages/main/extension-limits.js';

const LIMITS: ExtensionLimits = {
  requestDeadlineMs: 1_000, sourceFetchDeadlineMs: 130_000, activateDeadlineMs: 1_000, deactivateDeadlineMs: 500,
  messageBytes: 2_000, inFlight: 2, heartbeatMs: 1_000, heartbeatMisses: 2, restartBudget: 2, restartWindowMs: 600_000
};
const AT = '2026-10-11T18:00:00Z';
const GOOD: CardAnswer = { ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'alert', level: 'info', text: 'Quiet' }] } };

const nodePort = (port: MessagePort): Port => ({
  post: message => port.postMessage(message),
  onMessage: listener => { port.on('message', listener); },
  close: () => port.close()
});
// Real message passing, real microtasks; only the clock is the test's.
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(settle => setImmediate(settle)); };

interface Harness {
  readonly spawned: number;
  readonly killed: number;
  hang: boolean;
  crash(): void;
  activations: Record<string, number>;
}

// The real runtime, in process, behind a HostLink.
function inProcessHost(modules: Record<string, () => ExtensionModule>) {
  const harness: Harness = { spawned: 0, killed: 0, hang: false, crash: () => {}, activations: {} };
  const spawn = (): HostLink => {
    (harness as { spawned: number }).spawned += 1;
    const listeners: ((message: unknown) => void)[] = [];
    let exit: () => void = () => {};
    let alive = true;
    const runtime = createHostRuntime({
      importModule: async entry => {
        harness.activations[entry] = (harness.activations[entry] ?? 0) + 1;
        const make = modules[entry];
        if (!make) throw new Error('no such module');
        return make();
      },
      toBroker: message => { if (alive) queueMicrotask(() => { for (const listener of listeners) listener(message); }); }
    });
    harness.crash = () => { alive = false; exit(); };
    return {
      post(message, transfer) {
        if (!alive) return;
        if (harness.hang && message.type === 'ping') return;
        queueMicrotask(() => runtime.receive(message, transfer ? nodePort(transfer as MessagePort) : undefined));
      },
      onMessage: listener => { listeners.push(listener); },
      onExit: listener => { exit = listener; },
      kill: () => { alive = false; (harness as { killed: number }).killed += 1; }
    };
  };
  return { harness, spawn };
}

function supervisor(modules: Record<string, () => ExtensionModule>, overrides: Partial<SupervisorDeps> = {}) {
  const { harness, spawn } = inProcessHost(modules);
  const served: { id: string; request: unknown }[] = [];
  const warnings: string[] = [];
  const deps: SupervisorDeps = {
    limits: LIMITS,
    spawn,
    channel: () => { const { port1, port2 } = new MessageChannel(); return { broker: nodePort(port1), transfer: port2 }; },
    describe: id => (Object.hasOwn(modules, `/pkg/${id}/main.js`) ? { entry: `/pkg/${id}/main.js`, cards: ['card'] } : undefined),
    serve: async (id, request) => { served.push({ id, request }); return { ok: true, kind: 'extension.info', info: { id, name: id, tier: 'official', version: '1.0.0', grants: [] } }; },
    log: { info: () => {}, warn: (_fields, message) => { warnings.push(message); } },
    ...overrides
  };
  return { sup: createSupervisor(deps), harness, served, warnings };
}

const cardModule = (provide: (signal: AbortSignal) => Promise<CardAnswer> | CardAnswer, extra: Partial<ExtensionModule> = {}) =>
  (): ExtensionModule => ({ activate: context => { context.cards.register('card', ({ signal }) => provide(signal)); }, ...extra });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('P8-window: lazy start (QGD-APP-0023)', () => {
  it('starts no host and activates nothing until something is needed', async () => {
    const { sup, harness } = supervisor({ '/pkg/a/main.js': cardModule(() => GOOD) });
    await flush();
    expect(harness.spawned).toBe(0);
    expect(sup.status().host).toBe('not started');
    const outcome = await sup.card('a', 'card');
    expect(outcome).toEqual({ outcome: 'completed', answer: GOOD });
    expect(harness.spawned).toBe(1);
    sup.stop();
  });
});

describe('P8-identity: the channel is the identity (QGD-APP-0018)', () => {
  it('attributes a request to the extension whose channel it came on, whatever it names', async () => {
    let seen: unknown;
    const { sup, served } = supervisor({
      '/pkg/a/main.js': () => ({ activate: async context => { seen = await context.request({ kind: 'extension.info' }); } }),
      '/pkg/b/main.js': () => ({ activate: () => {} })
    });
    expect(await sup.ensureActive('a')).toEqual({ ok: true });
    await flush();
    expect(served.map(entry => entry.id)).toEqual(['a']);
    expect(seen).toMatchObject({ ok: true, info: { id: 'a' } });
    sup.stop();
  });

  it('runs nothing the core cannot describe: no package entry, no channel', async () => {
    const { sup, harness } = supervisor({ '/pkg/a/main.js': () => ({ activate: () => {} }) });
    expect(await sup.ensureActive('stranger')).toEqual({ ok: false, reason: 'That is not an extension this core runs.' });
    expect(harness.spawned).toBe(0);
    sup.stop();
  });
});

describe('P8-lifecycle (QGD-APP-0020)', () => {
  it('activates once when two cards need the same extension at the same time', async () => {
    const { sup, harness } = supervisor({ '/pkg/a/main.js': cardModule(() => GOOD) });
    const [one, two] = await Promise.all([sup.card('a', 'card'), sup.card('a', 'card')]);
    expect(one).toEqual({ outcome: 'completed', answer: GOOD });
    expect(two).toEqual({ outcome: 'completed', answer: GOOD });
    expect(harness.activations['/pkg/a/main.js']).toBe(1);
    sup.stop();
  });

  it('marks a failed activation, says so on its cards, and does not retry until re-enabled', async () => {
    let calls = 0; let disposed = 0;
    const { sup } = supervisor({ '/pkg/a/main.js': () => ({ activate: context => {
      calls++;
      context.subscriptions.push({ dispose: () => { disposed++; } });
      throw new Error('secret value 1234');
    } }) });
    const first = await sup.card('a', 'card');
    expect(first).toEqual({ outcome: 'completed', answer: { ok: false, reason: 'This extension could not start.' } });
    expect(JSON.stringify(sup.status())).not.toContain('1234');
    // What it registered before failing was disposed, so a retry starts clean.
    expect(disposed).toBe(1);
    await sup.card('a', 'card');
    expect(calls).toBe(1); // not retried
    await sup.setEnabled('a', true);
    await sup.card('a', 'card');
    expect(calls).toBe(2); // re-enabling retried it
    expect(disposed).toBe(2);
    expect(sup.status().failed.a).toBe('This extension could not start.');
    sup.stop();
  });

  it('deactivates on disable, answers turned off while disabled, and activates again on enable', async () => {
    let activations = 0; let deactivations = 0;
    const module = { activate: (context: Parameters<ExtensionModule['activate']>[0]) => { activations++; context.cards.register('card', () => GOOD); }, deactivate: () => { deactivations++; } };
    const { sup: counted } = supervisor({ '/pkg/a/main.js': () => module });
    await counted.card('a', 'card');
    await counted.setEnabled('a', false);
    expect(deactivations).toBe(1);
    expect(await counted.card('a', 'card')).toEqual({ outcome: 'completed', answer: { ok: false, reason: 'This extension is turned off.' } });
    await counted.setEnabled('a', true);
    expect(await counted.card('a', 'card')).toEqual({ outcome: 'completed', answer: GOOD });
    expect(activations).toBe(2);
    counted.stop();
  });

  it('restarts the host when a deactivate overruns, and reports every extension it affected', async () => {
    const { sup, harness } = supervisor({
      '/pkg/a/main.js': () => ({ activate: () => {}, deactivate: () => new Promise(() => {}) }),
      '/pkg/b/main.js': () => ({ activate: () => {} })
    });
    await sup.ensureActive('a'); await sup.ensureActive('b');
    const stopping = sup.setEnabled('a', false);
    await flush();
    await vi.advanceTimersByTimeAsync(LIMITS.deactivateDeadlineMs + 10);
    await stopping;
    expect(harness.killed).toBe(1);
    expect(sup.status().affected).toEqual(['b']);
    sup.stop();
  });
});

describe('P8-messages (QGD-APP-0021)', () => {
  it('ends a card past its deadline as unknown, and discards the answer that comes later', async () => {
    let finish: (answer: CardAnswer) => void = () => {};
    const { sup } = supervisor({ '/pkg/a/main.js': cardModule(() => new Promise<CardAnswer>(settle => { finish = settle; })) });
    await sup.ensureActive('a');
    const pending = sup.card('a', 'card');
    await flush();
    await vi.advanceTimersByTimeAsync(LIMITS.requestDeadlineMs + 10);
    expect(await pending).toEqual({ outcome: 'unknown', reason: 'The extension did not answer in time.' });
    // The answer arrives after the deadline and is dropped: nothing throws,
    // and the outcome already given stands.
    finish(GOOD);
    await flush();
    expect(await pending).toEqual({ outcome: 'unknown', reason: 'The extension did not answer in time.' });
    sup.stop();
  });

  it('ends a cancelled card as cancelled only when the extension confirms it', async () => {
    const { sup } = supervisor({
      '/pkg/a/main.js': cardModule(signal => new Promise<CardAnswer>((_, fail) => { signal.addEventListener('abort', () => fail(new Error('stopped'))); }))
    });
    await sup.ensureActive('a');
    const stop = new AbortController();
    const pending = sup.card('a', 'card', stop.signal);
    await flush();
    stop.abort();
    await flush();
    expect(await pending).toEqual({ outcome: 'cancelled' });
    sup.stop();
  });

  it('refuses an answer off the card shapes as a card that cannot be shown', async () => {
    const { sup } = supervisor({ '/pkg/a/main.js': cardModule(() => ({ ok: true, data: { version: 1, observedAt: AT, sections: [{ shape: 'html', html: '<b>' }] } }) as never) });
    expect(await sup.card('a', 'card')).toEqual({ outcome: 'completed', answer: { ok: false, reason: 'This card sent data that cannot be shown.' } });
    sup.stop();
  });

  it('refuses a request over the size limit and one over the in-flight limit, and answers a slow one at its deadline', async () => {
    const replies: unknown[] = [];
    let release: () => void = () => {};
    const hold = new Promise<void>(settle => { release = settle; });
    const { sup, served } = supervisor({
      '/pkg/a/main.js': () => ({ activate: context => {
        for (let i = 0; i < 3; i++) void context.request({ kind: 'callsign.list' }).then(reply => replies.push(reply));
        void context.request({ kind: 'source.fetch', source: 'x'.repeat(5_000) }).then(reply => replies.push(reply));
      } })
    }, { serve: async (id, request) => { served.push({ id, request }); await hold; return { ok: true, kind: 'callsign.list', callsigns: [] }; } } as Partial<SupervisorDeps>);
    await sup.ensureActive('a');
    await flush();
    expect(replies).toContainEqual({ ok: false, error: 'That request is larger than an extension may send.' });
    expect(replies).toContainEqual({ ok: false, error: 'This extension has too many requests waiting.' });
    expect(served).toHaveLength(LIMITS.inFlight);
    await vi.advanceTimersByTimeAsync(LIMITS.requestDeadlineMs + 10);
    await flush();
    expect(replies.filter(reply => JSON.stringify(reply).includes('did not answer in time'))).toHaveLength(LIMITS.inFlight);
    release();
    await flush();
    expect(replies).toHaveLength(4); // the late answers were discarded, not sent as second replies
    sup.stop();
  });
});

describe('P8-supervision (QGD-APP-0022)', () => {
  it('stops a host that stops answering, restarts it, and activates again what was active', async () => {
    const { sup, harness } = supervisor({ '/pkg/a/main.js': cardModule(() => GOOD) });
    await sup.ensureActive('a');
    harness.hang = true;
    await vi.advanceTimersByTimeAsync(LIMITS.heartbeatMs * (LIMITS.heartbeatMisses + 2));
    await flush();
    expect(harness.killed).toBe(1);
    expect(sup.status().affected).toEqual(['a']);
    harness.hang = false;
    await vi.advanceTimersByTimeAsync(600);
    await flush();
    expect(harness.spawned).toBe(2);
    expect(await sup.card('a', 'card')).toEqual({ outcome: 'completed', answer: GOOD });
    sup.stop();
  });

  it('counts an extension still starting when the host stops as affected, and counts the stop', async () => {
    const { sup, harness } = supervisor({ '/pkg/a/main.js': () => ({ activate: () => new Promise<void>(() => {}) }) });
    void sup.ensureActive('a');
    await flush();
    harness.crash();
    await flush();
    expect(sup.status().affected).toEqual(['a']);
    expect(sup.status().stops).toBe(1);
    expect(sup.status().stoppedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    sup.stop();
  });

  it('stops restarting at the budget and says so', async () => {
    const { sup, harness } = supervisor({ '/pkg/a/main.js': cardModule(() => GOOD) });
    for (let round = 0; round <= LIMITS.restartBudget; round++) {
      await sup.ensureActive('a');
      harness.crash();
      await flush();
      await vi.advanceTimersByTimeAsync(31_000);
      await flush();
    }
    expect(sup.status().host).toBe('stopped');
    expect(harness.spawned).toBe(LIMITS.restartBudget + 1);
    expect(await sup.card('a', 'card')).toEqual({ outcome: 'completed', answer: { ok: false, reason: 'The extension host stopped repeatedly and was not restarted.' } });
    sup.stop();
  });

  it('ends a card that was in flight when the host stopped as unknown', async () => {
    const { sup, harness } = supervisor({ '/pkg/a/main.js': cardModule(() => new Promise<CardAnswer>(() => {})) });
    await sup.ensureActive('a');
    const pending = sup.card('a', 'card');
    await flush();
    harness.crash();
    expect(await pending).toEqual({ outcome: 'unknown', reason: 'The extension host stopped.' });
    sup.stop();
  });
});

describe('review findings, each held by a test (S2)', () => {
  it('lets disable win against an activation still under way', async () => {
    let deactivations = 0;
    let open: () => void = () => {};
    const slow = new Promise<void>(settle => { open = settle; });
    const { sup } = supervisor({ '/pkg/a/main.js': () => ({ activate: async () => { await slow; }, deactivate: () => { deactivations++; } }) });
    const starting = sup.ensureActive('a');
    await flush();
    const stopping = sup.setEnabled('a', false);
    open();
    expect(await starting).toEqual({ ok: false, reason: 'This extension is turned off.' });
    await stopping;
    expect(deactivations).toBe(1);
    expect(await sup.card('a', 'card')).toEqual({ outcome: 'completed', answer: { ok: false, reason: 'This extension is turned off.' } });
    sup.stop();
  });

  it('keeps an extension on when it is turned off and back on while it was starting', async () => {
    let open: () => void = () => {};
    const slow = new Promise<void>(settle => { open = settle; });
    const { sup } = supervisor({ '/pkg/a/main.js': () => ({ activate: async context => { await slow; context.cards.register('card', () => GOOD); } }) });
    const starting = sup.ensureActive('a');
    await flush();
    const stopping = sup.setEnabled('a', false);
    await sup.setEnabled('a', true);
    open();
    await starting; await stopping;
    expect(await sup.card('a', 'card')).toEqual({ outcome: 'completed', answer: GOOD });
    sup.stop();
  });

  it('never lets a slow deactivation tear down the activation after it', async () => {
    let finish: () => void = () => {};
    const { sup } = supervisor({ '/pkg/a/main.js': () => ({
      activate: context => { context.cards.register('card', () => GOOD); },
      deactivate: () => new Promise<void>(settle => { finish = settle; })
    }) }, { limits: { ...LIMITS, deactivateDeadlineMs: 60_000 } } as Partial<SupervisorDeps>);
    await sup.ensureActive('a');
    const stopping = sup.setEnabled('a', false);
    await flush();
    await sup.setEnabled('a', true);
    const card = sup.card('a', 'card');
    await flush();
    finish();
    await stopping;
    // The new activation's provider survived the old deactivation.
    expect(await card).toEqual({ outcome: 'completed', answer: GOOD });
    expect(await sup.card('a', 'card')).toEqual({ outcome: 'completed', answer: GOOD });
    sup.stop();
  });

  it('does not run a card that was cancelled before it was sent', async () => {
    let ran = 0;
    const { sup } = supervisor({ '/pkg/a/main.js': cardModule(() => { ran++; return GOOD; }) });
    const stop = new AbortController(); stop.abort();
    expect(await sup.card('a', 'card', stop.signal)).toEqual({ outcome: 'cancelled' });
    await flush();
    expect(ran).toBe(0);
    sup.stop();
  });

  it('holds an in-flight slot until the work ends, not until its deadline', async () => {
    const replies: unknown[] = [];
    let release: () => void = () => {};
    const hold = new Promise<void>(settle => { release = settle; });
    let started = 0;
    let ctx: Parameters<ExtensionModule['activate']>[0] | undefined;
    const { sup } = supervisor({
      '/pkg/a/main.js': () => ({ activate: context => { ctx = context; } })
    }, { serve: async () => { started++; await hold; return { ok: true, kind: 'callsign.list', callsigns: [] }; } } as Partial<SupervisorDeps>);
    await sup.ensureActive('a');
    for (let i = 0; i < LIMITS.inFlight; i++) void ctx!.request({ kind: 'callsign.list' }).then(reply => replies.push(reply));
    await flush();
    await vi.advanceTimersByTimeAsync(LIMITS.requestDeadlineMs + 10);
    await flush();
    expect(replies.filter(reply => JSON.stringify(reply).includes('did not answer in time'))).toHaveLength(LIMITS.inFlight);
    // The deadline has passed but the work has not ended, so the slots are
    // still taken: the next request is refused, not started.
    const next = await ctx!.request({ kind: 'callsign.list' });
    expect(next).toEqual({ ok: false, error: 'This extension has too many requests waiting.' });
    expect(started).toBe(LIMITS.inFlight);
    // When the work ends the slots come back.
    release();
    await flush();
    const after = ctx!.request({ kind: 'callsign.list' });
    await flush();
    expect(started).toBe(LIMITS.inFlight + 1);
    sup.stop();
    void after;
  });

  it('counts the size limit in bytes, not characters', async () => {
    const replies: unknown[] = [];
    const { sup, served } = supervisor({
      // 700 characters of four-byte text: under 2,000 characters, over 2,000 bytes.
      '/pkg/a/main.js': () => ({ activate: context => { void context.request({ kind: 'source.fetch', source: '😀'.repeat(700) }).then(reply => replies.push(reply)); } })
    });
    await sup.ensureActive('a');
    await flush();
    expect(replies).toEqual([{ ok: false, error: 'That request is larger than an extension may send.' }]);
    expect(served).toHaveLength(0);
    sup.stop();
  });
});
