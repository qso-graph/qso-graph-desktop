// SPDX-License-Identifier: GPL-3.0-only
// Home's cards: which are available, and when each pinned one is refreshed
// (QGD-HOM-0001, QGD-HOM-0005, QGD-HOM-0006).
//
// The broker decides when a card refreshes; an extension never polls on its
// own. A card is asked for only when it is pinned, Home is showing, and its
// interval has passed. Leaving Home or unpinning a card cancels what is in
// flight, and an answer that arrives after the persona changed is dropped.
//
// No Electron here, and the clock and the supervisor are passed in, so all of
// it runs under unit tests with time the test controls.
import type { CardView } from './home-contract.js';
import type { CardOutcome } from './extension-host-supervisor.js';

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
}

export type { CardView } from './home-contract.js';

export interface CardSchedulerDeps {
  catalogue(): readonly CatalogueCard[];
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
  // card unpinned, the persona changed. An answer to an older question is
  // recognised and dropped.
  generation: number;
  view?: CardView;
}

export function createCardScheduler(deps: CardSchedulerDeps) {
  let visible = false;
  let stopped = false;
  const tracked = new Map<string, Tracked>();
  // When each card was last asked, kept apart from everything else: unpinning
  // and re-pinning, hiding Home or changing persona never let a card be asked
  // sooner than its interval allows (QGD-HOM-0005).
  const lastAsked = new Map<string, number>();

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
    const entry = tracked.get(card.key) ?? { generation: 0 };
    tracked.set(card.key, entry);
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
      // and nothing more is asked (QGD-HOM-0005).
      halt(entry);
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
    // A persona was added, changed, removed or made active. What is shown and
    // what is in flight belong to the old one: both are dropped, and each card
    // is asked again when its interval allows.
    personasChanged(): void {
      for (const [key, entry] of tracked) {
        halt(entry);
        publish(entry, { key, state: 'waiting' });
      }
      reconcile();
    },
    // What each shown card last said, for a screen that has just opened.
    views(): CardView[] {
      return shown().map(card => tracked.get(card.key)?.view ?? { key: card.key, state: 'waiting' });
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
