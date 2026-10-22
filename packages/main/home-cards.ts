// SPDX-License-Identifier: GPL-3.0-only
// Extension pages: which are available, and when the open one is refreshed
// (QGD-HOM-0001, QGD-HOM-0005, QGD-HOM-0006).
//
// The broker decides when a page refreshes; an extension never polls on its
// own. A page is asked for only while it is open on screen and its interval
// has passed (KI7MT, 2026-10-22: Home is tiles, and asks for nothing).
// Leaving the page cancels what is in flight, and an answer that arrives
// after the callsign changed is dropped.
//
// No Electron here, and the clock and the supervisor are passed in, so all of
// it runs under unit tests with time the test controls.
import type { CardView } from './home-contract.js';
import type { CardOutcome } from './extension-host-supervisor.js';
import { MAX_PINS } from './settings-contract.js';

// A card some loaded, enabled extension offers. `key` is "extension/card",
// which is what a pin names.
export interface CatalogueCard {
  readonly key: string;
  readonly extension: string;
  readonly extensionName: string;
  readonly card: string;
  readonly name: string;
  readonly description: string;
  readonly refreshSeconds: number;
  readonly icon: string;
  readonly rail: boolean;
}

export type { CardView } from './home-contract.js';

export interface CardSchedulerDeps {
  catalogue(): readonly CatalogueCard[];
  // The pages on screen: the open one, or none.
  pins(): readonly string[];
  card(extension: string, card: string, signal: AbortSignal): Promise<CardOutcome>;
  publish(view: CardView): void;
  now(): number;
}

interface Tracked {
  timer?: ReturnType<typeof setTimeout>;
  // What is in flight. Held until it settles, even once cancelled, so a card
  // is never asked twice at once.
  work?: AbortController;
  // Bumped whenever an answer in flight stops being wanted: Home hidden, the
  // card unpinned, the callsign changed. An answer to an older question is
  // recognised and dropped.
  generation: number;
  view?: CardView;
}

export function createCardScheduler(deps: CardSchedulerDeps) {
  let visible = false;
  let stopped = false;
  const tracked = new Map<string, Tracked>();
  // When each card was last asked, kept apart from everything else: unpinning
  // and re-pinning or hiding Home never let a card be asked sooner than its
  // interval allows (QGD-HOM-0005). A callsign change is the one exception,
  // below.
  const lastAsked = new Map<string, number>();
  // What a card last said, kept when it stops being shown (unpinned, or its
  // extension turned off), so that shown again inside its interval it shows
  // that rather than "Getting the latest…" until the interval runs out. A
  // callsign change drops it with everything else.
  const kept = new Map<string, CardView>();

  // The pinned cards that some extension offers, in pin order.
  function shown(): CatalogueCard[] {
    const available = new Map(deps.catalogue().map(card => [card.key, card]));
    return deps.pins().flatMap(pin => { const card = available.get(pin); return card ? [card] : []; });
  }

  // Cancel what is in flight and stop the clock; the answer, if one still
  // comes, is for an older generation and is dropped.
  function halt(entry: Tracked): void {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    entry.generation += 1;
    entry.work?.abort();
  }

  function publish(entry: Tracked, view: CardView): void {
    entry.view = view;
    deps.publish(view);
  }

  function schedule(card: CatalogueCard): void {
    if (!visible || stopped) return;
    let entry = tracked.get(card.key);
    if (!entry) {
      entry = { generation: 0 };
      tracked.set(card.key, entry);
      const before = kept.get(card.key);
      if (before) { kept.delete(card.key); publish(entry, before); }
    }
    if (entry.timer || entry.work) return;
    const last = lastAsked.get(card.key);
    const due = last === undefined ? 0 : last + card.refreshSeconds * 1000 - deps.now();
    if (due <= 0) void ask(card, entry);
    else entry.timer = setTimeout(() => { entry.timer = undefined; void ask(card, entry); }, due);
  }

  async function ask(card: CatalogueCard, entry: Tracked): Promise<void> {
    if (!visible || stopped || entry.work) return;
    // Pinned still, and still offered: checked at the moment of asking.
    if (!shown().some(candidate => candidate.key === card.key)) return;
    const generation = entry.generation;
    const work = new AbortController();
    entry.work = work;
    lastAsked.set(card.key, deps.now());
    if (!entry.view) publish(entry, { key: card.key, state: 'waiting' });
    let outcome: CardOutcome;
    try {
      outcome = await deps.card(card.extension, card.card, work.signal);
    } finally {
      if (entry.work === work) entry.work = undefined;
    }
    const current = !stopped && generation === entry.generation && tracked.get(card.key) === entry;
    if (current && outcome.outcome === 'completed') {
      publish(entry, { key: card.key, state: 'ready', answer: outcome.answer, fetchedAt: new Date(deps.now()).toISOString() });
    } else if (current && outcome.outcome === 'unknown') {
      publish(entry, { key: card.key, state: 'failed', reason: outcome.reason });
    }
    // Whatever happened, the next question is decided by the clock.
    if (tracked.get(card.key) === entry) schedule(card);
  }

  function reconcile(): void {
    const keep = new Set(shown().map(card => card.key));
    for (const [key, entry] of tracked) {
      if (keep.has(key)) continue;
      // Unpinned, or its extension turned off: what is in flight is cancelled
      // and nothing more is asked (QGD-HOM-0005). An answer it had is kept.
      halt(entry);
      if (entry.view && entry.view.state !== 'waiting') kept.set(key, entry.view);
      tracked.delete(key);
    }
    for (const card of shown()) schedule(card);
  }

  return {
    // Home shown or hidden. Hidden, nothing is asked and what is in flight is
    // cancelled; shown again, each card is asked when its interval allows.
    setVisible(showing: boolean): void {
      visible = showing;
      if (!showing) { for (const entry of tracked.values()) halt(entry); return; }
      reconcile();
    },
    // The pins changed, or an extension was turned on or off.
    changed(): void { reconcile(); },
    // A callsign was added, changed, removed or made active. What is shown and
    // what is in flight belong to the old one: both are dropped, and each card
    // is asked again, once, when Home shows (QGD-HOM-0005). Waiting out the
    // interval instead left Conditions saying "Getting the latest…" for
    // fifteen minutes after a new user made their first callsign. Callsign
    // changes are made on the Callsigns page, while Home is hidden, so this
    // costs at most one question per card per return to Home.
    callsignsChanged(): void {
      for (const [key, entry] of tracked) {
        halt(entry);
        publish(entry, { key, state: 'waiting' });
      }
      lastAsked.clear();
      kept.clear();
      reconcile();
    },
    // What each shown card last said, for a screen that has just opened.
    views(): CardView[] {
      return shown().map(card => tracked.get(card.key)?.view ?? kept.get(card.key) ?? { key: card.key, state: 'waiting' });
    },
    shown,
    stop(): void {
      stopped = true;
      for (const entry of tracked.values()) halt(entry);
      tracked.clear();
    }
  };
}

export type CardScheduler = ReturnType<typeof createCardScheduler>;

// The pins to save when the operator saves `chosen`. "Customize your pins"
// lists only the cards that are offered, so a pin whose extension is turned
// off is not in what it sends back. It keeps its place: the chosen cards fill
// the offered cards' places in order, and any more follow (QGD-HOM-0003,
// QGD-HOM-0007). Undefined when they would not all fit, which the picker
// prevents by offering only the room that is left (see hiddenPins).
export function keepHidden(chosen: readonly string[], stored: readonly string[], offered: readonly CatalogueCard[]): string[] | undefined {
  const keys = new Set(offered.map(card => card.key));
  const queue = chosen.filter(pin => keys.has(pin));
  const out: string[] = [];
  for (const pin of stored) {
    if (!keys.has(pin)) out.push(pin);
    else if (queue.length > 0) out.push(queue.shift()!);
  }
  out.push(...queue);
  return out.length <= MAX_PINS ? out : undefined;
}
