// SPDX-License-Identifier: GPL-3.0-only
// Home's state in the window (QGD-HOM-0001 to QGD-HOM-0006): the pages on
// offer, the pins drawn as tiles, and what the open page last said. Home
// itself fetches nothing (KI7MT, 2026-10-22).
//
// Everything arriving here is checked before it is kept (QGD-SEC-0006): the
// state against the Home contract, and each pushed page against the page
// shapes. Plain TypeScript, as shell-store.ts is, so a story can make one
// with no window behind it.
import { isPageView, isHomeReply, isHostNotice, type AvailablePage, type PageView, type HomeState, type HostNotice } from '../main/home-contract.js';
import type { PageShown } from '../ui/page-shapes.js';

export interface HomeApi {
  request(command: unknown): Promise<unknown>;
  onPage(listener: (page: unknown) => void): () => void;
  onNotice?(listener: (notice: unknown) => void): () => void;
  onReached?(listener: (reached: unknown) => void): () => void;
}

// A pinned page, as its tile draws it: from the manifest, nothing fetched.
export interface Tile {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
}

export interface HomeModel {
  readonly available: readonly AvailablePage[];
  // What can be pinned: each area once, by its first page (KI7MT,
  // 2026-10-23: a pin opens an area, and its pages are tabs).
  readonly areas: readonly AvailablePage[];
  readonly pins: readonly string[];
  // The pinned pages some extension offers, in pin order.
  readonly tiles: readonly Tile[];
  // The pages that also have a rail item.
  readonly railPages: readonly AvailablePage[];
  // The open page and what it last said, or null on Home.
  readonly page: {
    readonly key: string; readonly name: string; readonly shown: PageShown;
    // Whether it needs the internet (an extension that may fetch).
    readonly network: boolean;
    // The page's fields, and what was last asked with them.
    readonly inputs: AvailablePage['inputs']; readonly values: Readonly<Record<string, string>>;
    // Its area's name and first page, and the area's pages as tabs, when it
    // has more than one.
    readonly area: string; readonly areaName: string;
    readonly tabs: readonly { readonly key: string; readonly label: string }[];
  } | null;
  // Which extensions a stopped extension host affected (QGD-APP-0022).
  readonly notice: HostNotice | null;
  // On a network, as the operating system says (KI7MT, 2026-10-23).
  readonly online: boolean;
  // Whether the last request a page made reached its source; null when none
  // has since the network came up. The Internet lamp's yellow.
  readonly reached: boolean | null;
  readonly error?: string;
}

// What a page's view means on screen. An extension that answered with
// nothing to show is a failure in words on that page (QGD-HOM-0006).
export function shownOf(view: PageView): PageShown {
  if (view.state === 'waiting') return { state: 'waiting' };
  if (view.state === 'failed') return { state: 'failed', reason: view.reason };
  if (!view.answer.ok) return { state: 'failed', reason: view.answer.reason };
  return { state: 'ready', observedAt: view.answer.data.observedAt, sections: view.answer.data.sections };
}

function model(state: HomeState, views: ReadonlyMap<string, PageView>, notice: HostNotice | null, open: string | null, values: Readonly<Record<string, string>>, online: boolean, reached: boolean | null, error?: string): HomeModel {
  const offered = new Map(state.available.map(page => [page.key, page]));
  const opened = open === null ? undefined : offered.get(open);
  const areas = state.available.filter(page => page.area === page.key);
  // A pin names an area by its first page; a pin to a page that has since
  // moved under another opens that page's area, and is drawn once.
  const pinned = [...new Set(state.pins.flatMap(key => {
    const page = offered.get(key);
    return page ? [page.area] : [];
  }))];
  const head = opened ? offered.get(opened.area) ?? opened : undefined;
  const inArea = opened ? state.available.filter(page => page.area === opened.area) : [];
  return {
    available: state.available,
    areas,
    pins: state.pins,
    tiles: pinned.flatMap(key => {
      const page = offered.get(key);
      return page ? [{ key, name: page.name, description: page.description, icon: page.icon }] : [];
    }),
    railPages: areas.filter(page => page.rail),
    page: opened && head ? {
      key: opened.key, name: opened.name, shown: shownOf(views.get(opened.key) ?? { key: opened.key, state: 'waiting' }),
      network: opened.network, inputs: opened.inputs, values,
      area: head.key, areaName: head.name,
      tabs: inArea.length > 1 ? inArea.map(page => ({ key: page.key, label: page.tab })) : []
    } : null,
    notice,
    online,
    reached,
    ...(error ? { error } : {})
  };
}

const EMPTY: HomeState = { available: [], pins: [], pages: [], notice: null, reached: null };

export function createHomeStore(api: HomeApi | undefined, initial?: { state: HomeState; error?: string }) {
  let state: HomeState = initial?.state ?? EMPTY;
  let error = initial?.error;
  const views = new Map<string, PageView>(state.pages.map(page => [page.key, page]));
  const listeners = new Set<(value: HomeModel) => void>();
  // The extension page on screen, or null.
  let open: string | null = null;
  let values: Readonly<Record<string, string>> = {};
  // As the operating system last said; told to the broker at the start and
  // whenever it changes. Unknown until then, so the first reading is sent.
  let online: boolean | undefined;
  // Pushed when it changes; read from the state until the first push.
  let reached: boolean | null = null;
  let reachPushes = 0;
  // Pushes are numbered, so a snapshot read before a push cannot replace it.
  let pushes = 0;
  const pushedAt = new Map<string, number>();
  // The latest notice. Pushes are counted, and a reply only carries the notice
  // when no push has arrived since its request was sent: a reply composed
  // before a newer stop must not hide it (Turing, review of this change).
  let notice: HostNotice | null = state.notice;
  let noticePushes = 0;

  const current = () => model(state, views, notice, open, values, online ?? true, reached, error);
  const changed = () => { const value = current(); for (const listener of listeners) listener(value); };

  // `asked` is how many pushes had arrived when the request was sent: a page
  // pushed since then is newer than the snapshot's, and is kept.
  function take(reply: unknown, failure: string, asked: number, askedNotice: number): void {
    if (isHomeReply(reply) && reply.ok) {
      state = reply.state;
      if (noticePushes === askedNotice) notice = reply.state.notice;
      if (reachPushes === 0) reached = reply.state.reached;
      for (const page of reply.state.pages) {
        if ((pushedAt.get(page.key) ?? 0) <= asked) views.set(page.key, page);
      }
      error = undefined;
    } else {
      error = isHomeReply(reply) && !reply.ok ? reply.error : failure;
    }
    changed();
  }

  return {
    get: current,
    subscribe(listener: (value: HomeModel) => void): () => void {
      listeners.add(listener);
      listener(current());
      return () => listeners.delete(listener);
    },
    // Starts listening for pushed pages and reads the state once.
    start(): () => void {
      if (!api) return () => undefined;
      const stopPages = api.onPage(page => {
        if (!isPageView(page)) return;
        pushedAt.set(page.key, ++pushes);
        views.set(page.key, page);
        changed();
      });
      const stopNotices = api.onNotice?.(pushed => {
        if (!isHostNotice(pushed)) return;
        notice = pushed;
        noticePushes += 1;
        changed();
      });
      const stopReached = api.onReached?.(pushed => {
        if (pushed !== null && typeof pushed !== 'boolean') return;
        reached = pushed;
        reachPushes += 1;
        changed();
      });
      const stop = () => { stopPages(); stopNotices?.(); stopReached?.(); };
      const asked = pushes;
      const askedNotice = noticePushes;
      void api.request({ type: 'read' }).then(reply => take(reply, 'Home could not be read.', asked, askedNotice), () => take(undefined, 'Home could not be read.', asked, askedNotice));
      return stop;
    },
    // Which extension page is on screen, or null. Only it is asked for
    // (QGD-HOM-0005).
    // With `inputs`, what is in its fields (inputs.ts): a new question.
    openPage(key: string | null, inputs?: Readonly<Record<string, string>>): void {
      const next = key === open ? (inputs ?? values) : (inputs ?? {});
      if (open === key && JSON.stringify(next) === JSON.stringify(values)) return;
      open = key;
      values = next;
      changed();
      if (!api) return;
      const asked = pushes;
      const askedNotice = noticePushes;
      const command = Object.keys(next).length > 0 ? { type: 'open', key, inputs: { ...next } } : { type: 'open', key };
      void api.request(command).then(reply => take(reply, 'The page could not be opened.', asked, askedNotice), () => undefined);
    },
    // Read the state again: what extensions offer changes when one is turned
    // on or off in Settings, and Home is drawn from it, so Home asks each time
    // it comes on screen (it used to, as a side effect of saying it was
    // showing, until Home stopped fetching; home-pages caught the stale tile).
    refresh(): void {
      if (!api) return;
      const asked = pushes;
      const askedNotice = noticePushes;
      void api.request({ type: 'read' }).then(reply => take(reply, 'Home could not be read.', asked, askedNotice), () => take(undefined, 'Home could not be read.', asked, askedNotice));
    },
    // The operating system said the network went or came back (the window's
    // online and offline events). Nothing is polled to learn it.
    setConnection(next: boolean): void {
      if (next === online) return;
      online = next;
      changed();
      if (!api) return;
      const asked = pushes;
      const askedNotice = noticePushes;
      void api.request({ type: 'connection', online: next }).then(reply => take(reply, 'Home could not be told the network changed.', asked, askedNotice), () => undefined);
    },
    // Ask the open page again now (Refresh).
    refreshPage(key: string): void {
      if (!api || key !== open) return;
      const asked = pushes;
      const askedNotice = noticePushes;
      void api.request({ type: 'refresh', key }).then(reply => take(reply, 'The page could not be refreshed.', asked, askedNotice), () => undefined);
    },
    // Hide the extension host's notice for the stop it is about.
    dismissNotice(id: number): void {
      if (!api) return;
      const asked = pushes;
      const askedNotice = noticePushes;
      void api.request({ type: 'dismiss', id }).then(reply => take(reply, 'The notice could not be dismissed.', asked, askedNotice),
        () => take(undefined, 'The notice could not be dismissed.', asked, askedNotice));
    },
    // The pins, in the operator's order (QGD-HOM-0003).
    savePins(pins: readonly string[]): void {
      if (!api) return;
      const asked = pushes;
      const askedNotice = noticePushes;
      void api.request({ type: 'pin', pins: [...pins] }).then(reply => take(reply, 'The pins could not be saved.', asked, askedNotice), () => take(undefined, 'The pins could not be saved.', asked, askedNotice));
    }
  };
}

export type HomeStore = ReturnType<typeof createHomeStore>;
