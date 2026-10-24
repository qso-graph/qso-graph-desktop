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
import type { PageInput } from '../extension-api/inputs.js';
import type { PageView } from './home-contract.js';
import type { PageOutcome } from './extension-host-supervisor.js';
import { MAX_PINS } from './settings-contract.js';

// A page some loaded, enabled extension offers. `key` is "extension/page",
// which is what a pin names.
export interface CataloguePage {
  readonly key: string;
  readonly extension: string;
  readonly extensionName: string;
  readonly page: string;
  readonly name: string;
  readonly description: string;
  readonly refreshSeconds: number;
  readonly icon: string;
  readonly rail: boolean;
  readonly inputs: readonly PageInput[];
  // Whether it needs the internet: its extension may ask the core to fetch
  // (a source: or service: grant). Asked for only while online.
  readonly network: boolean;
  // The key of its area's first page (its own, when it is under none), and
  // its tab's name (manifest.ts under and tab).
  readonly area?: string;
  readonly tab?: string;
  // The theme token of its colour on the rail (manifest.ts PAGE_HUES).
  readonly hue?: string;
}

export type { PageView } from './home-contract.js';

export interface PageSchedulerDeps {
  catalogue(): readonly CataloguePage[];
  // The pages on screen: the open one, or none.
  pins(): readonly string[];
  page(extension: string, page: string, signal: AbortSignal, inputs: Readonly<Record<string, string>>): Promise<PageOutcome>;
  // What is in a page's fields now, checked by kind (inputs.ts); none when
  // it has no fields or they are empty.
  inputs?(key: string): Readonly<Record<string, string>>;
  publish(view: PageView): void;
  now(): number;
  // Whether the computer is on a network, as the operating system says
  // (KI7MT, 2026-10-23). Absent, online.
  online?(): boolean;
}

interface Tracked {
  timer?: ReturnType<typeof setTimeout>;
  // What is in flight. Held until it settles, even once cancelled, so a page
  // is never asked twice at once.
  work?: AbortController;
  // Bumped whenever an answer in flight stops being wanted: Home hidden, the
  // page unpinned, the callsign changed. An answer to an older question is
  // recognised and dropped.
  generation: number;
  view?: PageView;
  // The inputs its view answered, so it is never shown again for others.
  inputs?: string;
}

// The least time between two questions the operator asks for with Refresh
// (KI7MT, 2026-10-23). The operator is not throttled: a press inside it is
// answered by what was fetched moments ago. It keeps a button held down, or
// pressed in a hurry, from becoming a burst at somebody else's service.
export const REFRESH_FLOOR_MS = 10_000;

export function createPageScheduler(deps: PageSchedulerDeps) {
  let visible = false;
  let stopped = false;
  const tracked = new Map<string, Tracked>();
  // When each page was last asked, kept apart from everything else: unpinning
  // and re-pinning or hiding Home never let a page be asked sooner than its
  // interval allows (QGD-HOM-0005). A callsign change is the one exception,
  // below.
  const lastAsked = new Map<string, number>();
  // What a page last said, kept when it stops being shown (unpinned, or its
  // extension turned off), so that shown again inside its interval it shows
  // that rather than "Getting the latest…" until the interval runs out. A
  // callsign change drops it with everything else.
  // With the inputs it answered: shown again only for the same ones.
  const kept = new Map<string, { view: PageView; inputs: string | undefined }>();
  // The pages with a question in flight, held apart from the tracked entries:
  // a page left and opened again while asking gets a new entry, and must not
  // be asked a second time until the first question settles (Codex review,
  // 2026-10-23).
  const busy = new Set<string>();
  const inputsOf = (key: string) => JSON.stringify(deps.inputs?.(key) ?? {});

  // The pinned pages that some extension offers, in pin order.
  function shown(): CataloguePage[] {
    const available = new Map(deps.catalogue().map(page => [page.key, page]));
    return deps.pins().flatMap(pin => { const page = available.get(pin); return page ? [page] : []; });
  }

  // Cancel what is in flight and stop the clock; the answer, if one still
  // comes, is for an older generation and is dropped.
  // A question cancelled before it had any answer leaves nothing to show,
  // so it does not count against the interval: the page is asked again when
  // it next shows, not a whole interval later (Codex review, 2026-10-23).
  function halt(entry: Tracked, key?: string): void {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    entry.generation += 1;
    if (entry.work && key !== undefined && (!entry.view || entry.view.state === 'waiting')) lastAsked.delete(key);
    entry.work?.abort();
  }

  function publish(entry: Tracked, view: PageView): void {
    entry.view = view;
    deps.publish(view);
  }

  // A page that needs the internet, while the computer has none: asked
  // nothing, and no timer is left running for it, so an offline laptop is not
  // woken to try (KI7MT, 2026-10-23: low power off the grid). What it showed
  // stays; with nothing to show, it says why.
  const offline = (page: CataloguePage) => page.network && deps.online?.() === false;

  function schedule(page: CataloguePage): void {
    if (!visible || stopped) return;
    let entry = tracked.get(page.key);
    if (!entry) {
      entry = { generation: 0 };
      tracked.set(page.key, entry);
      const before = kept.get(page.key);
      kept.delete(page.key);
      // What it said for other inputs is not shown: it is asked afresh.
      if (before && before.inputs === inputsOf(page.key)) { entry.inputs = before.inputs; publish(entry, before.view); }
      else if (before) lastAsked.delete(page.key);
    }
    if (entry.timer || entry.work) return;
    if (offline(page)) {
      if (!entry.view || entry.view.state === 'waiting') publish(entry, { key: page.key, state: 'failed', reason: `Offline. ${page.name} needs the internet.`.slice(0, 160) });
      return;
    }
    const last = lastAsked.get(page.key);
    const due = last === undefined ? 0 : last + page.refreshSeconds * 1000 - deps.now();
    if (due <= 0) void ask(page, entry);
    else entry.timer = setTimeout(() => { entry.timer = undefined; void ask(page, entry); }, due);
  }

  async function ask(page: CataloguePage, entry: Tracked): Promise<void> {
    if (!visible || stopped || entry.work || busy.has(page.key)) return;
    if (offline(page)) { schedule(page); return; }
    // Pinned still, and still offered: checked at the moment of asking.
    if (!shown().some(candidate => candidate.key === page.key)) return;
    const generation = entry.generation;
    const work = new AbortController();
    entry.work = work;
    lastAsked.set(page.key, deps.now());
    busy.add(page.key);
    if (!entry.view) publish(entry, { key: page.key, state: 'waiting' });
    const given = deps.inputs?.(page.key) ?? {};
    let outcome: PageOutcome;
    try {
      outcome = await deps.page(page.extension, page.page, work.signal, given);
    } finally {
      if (entry.work === work) entry.work = undefined;
      busy.delete(page.key);
    }
    const current = !stopped && generation === entry.generation && tracked.get(page.key) === entry;
    if (current && outcome.outcome === 'completed') {
      entry.inputs = JSON.stringify(given);
      publish(entry, { key: page.key, state: 'ready', answer: outcome.answer, fetchedAt: new Date(deps.now()).toISOString() });
    } else if (current && outcome.outcome === 'unknown') {
      publish(entry, { key: page.key, state: 'failed', reason: outcome.reason });
    }
    // Whatever happened, the next question is decided by the clock, for this
    // entry or the one that replaced it while this was asked.
    if (tracked.has(page.key)) schedule(page);
  }

  function reconcile(): void {
    const keep = new Set(shown().map(page => page.key));
    for (const [key, entry] of tracked) {
      if (keep.has(key)) continue;
      // Unpinned, or its extension turned off: what is in flight is cancelled
      // and nothing more is asked (QGD-HOM-0005). An answer it had is kept.
      halt(entry, key);
      if (entry.view && entry.view.state !== 'waiting') kept.set(key, { view: entry.view, inputs: entry.inputs });
      tracked.delete(key);
    }
    for (const page of shown()) schedule(page);
  }

  return {
    // Home shown or hidden. Hidden, nothing is asked and what is in flight is
    // cancelled; shown again, each page is asked when its interval allows.
    setVisible(showing: boolean): void {
      visible = showing;
      if (!showing) { for (const [key, entry] of tracked) halt(entry, key); return; }
      reconcile();
    },
    // The pins changed, or an extension was turned on or off.
    changed(): void { reconcile(); },
    // A callsign was added, changed, removed or made active. What is shown and
    // what is in flight belong to the old one: both are dropped, and each page
    // is asked again, once, when Home shows (QGD-HOM-0005). Waiting out the
    // interval instead left Conditions saying "Getting the latest…" for
    // fifteen minutes after a new user made their first callsign. Callsign
    // changes are made on the Callsigns page, while Home is hidden, so this
    // costs at most one question per page per return to Home.
    callsignsChanged(): void {
      for (const [key, entry] of tracked) {
        halt(entry);
        publish(entry, { key, state: 'waiting' });
      }
      lastAsked.clear();
      kept.clear();
      reconcile();
    },
    // The operator changed what is in a page's fields (inputs.ts): a new
    // question, asked now rather than when the interval allows. What is shown
    // stays until the answer replaces it, as with Refresh: dropping it first
    // emptied the page while it was asked, and the page, collapsed, sent the
    // operator back to its top (KI7MT, 2026-10-23).
    inputsChanged(key: string): void {
      const entry = tracked.get(key);
      if (entry) halt(entry);
      lastAsked.delete(key);
      kept.delete(key);
      reconcile();
    },
    // The operator pressed Refresh: ask now rather than when the interval
    // allows, unless a question is in flight or one was asked inside the
    // floor. What is shown stays until the answer replaces it. Says whether
    // it asked.
    refreshNow(key: string): boolean {
      const entry = tracked.get(key);
      const page = shown().find(candidate => candidate.key === key);
      if (!entry || !page || !visible || stopped || entry.work || offline(page)) return false;
      const last = lastAsked.get(key);
      if (last !== undefined && deps.now() - last < REFRESH_FLOOR_MS) return false;
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
      void ask(page, entry);
      return true;
    },
    // The operating system said the network went or came back. Gone: what an
    // internet page has in flight or waiting is stopped. Back: each is asked
    // at once, since what it shows is from before.
    connectionChanged(): void {
      const pages = new Map(shown().map(page => [page.key, page]));
      for (const [key, entry] of tracked) {
        const page = pages.get(key);
        if (!page?.network) continue;
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
        if (deps.online?.() === false) { entry.generation += 1; entry.work?.abort(); }
        else {
          lastAsked.delete(key);
          if (entry.view?.state === 'failed') { publish(entry, { key, state: 'waiting' }); }
        }
      }
      reconcile();
    },
    // What each shown page last said, for a screen that has just opened.
    views(): PageView[] {
      return shown().map(page => tracked.get(page.key)?.view ?? kept.get(page.key)?.view ?? { key: page.key, state: 'waiting' });
    },
    shown,
    stop(): void {
      stopped = true;
      for (const entry of tracked.values()) halt(entry);
      tracked.clear();
    }
  };
}

export type PageScheduler = ReturnType<typeof createPageScheduler>;

// The pins to save when the operator saves `chosen`. "Customize your pins"
// lists only the pages that are offered, so a pin whose extension is turned
// off is not in what it sends back. It keeps its place: the chosen pages fill
// the offered pages' places in order, and any more follow (QGD-HOM-0003,
// QGD-HOM-0007). Undefined when they would not all fit, which the picker
// prevents by offering only the room that is left (see hiddenPins).
export function keepHidden(chosen: readonly string[], stored: readonly string[], offered: readonly CataloguePage[]): string[] | undefined {
  const keys = new Set(offered.map(page => page.key));
  const queue = chosen.filter(pin => keys.has(pin));
  const out: string[] = [];
  for (const pin of stored) {
    if (!keys.has(pin)) out.push(pin);
    else if (queue.length > 0) out.push(queue.shift()!);
  }
  out.push(...queue);
  return out.length <= MAX_PINS ? out : undefined;
}
