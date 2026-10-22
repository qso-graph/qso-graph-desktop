// SPDX-License-Identifier: GPL-3.0-only
// Home's state in the window (QGD-HOM-0001 to QGD-HOM-0006): the pages on
// offer, the pins drawn as tiles, and what the open page last said. Home
// itself fetches nothing (KI7MT, 2026-10-22).
//
// Everything arriving here is checked before it is kept (QGD-SEC-0006): the
// state against the Home contract, and each pushed card against the card
// shapes. Plain TypeScript, as shell-store.ts is, so a story can make one
// with no window behind it.
import { isCardView, isHomeReply, isHostNotice, type AvailableCard, type CardView, type HomeState, type HostNotice } from '../main/home-contract.js';
import type { CardShown } from '../ui/home-card.js';

export interface HomeApi {
  request(command: unknown): Promise<unknown>;
  onCard(listener: (card: unknown) => void): () => void;
  onNotice?(listener: (notice: unknown) => void): () => void;
}

// A pinned page, as its tile draws it: from the manifest, nothing fetched.
export interface Tile {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
}

export interface HomeModel {
  readonly available: readonly AvailableCard[];
  readonly pins: readonly string[];
  // The pinned pages some extension offers, in pin order.
  readonly tiles: readonly Tile[];
  // The pages that also have a rail item.
  readonly railPages: readonly AvailableCard[];
  // The open page and what it last said, or null on Home.
  readonly page: { readonly key: string; readonly name: string; readonly shown: CardShown } | null;
  // Which extensions a stopped extension host affected (QGD-APP-0022).
  readonly notice: HostNotice | null;
  readonly error?: string;
}

// What a card's view means on screen. An extension that answered with
// nothing to show is a failure in words on that card (QGD-HOM-0006).
export function shownOf(view: CardView): CardShown {
  if (view.state === 'waiting') return { state: 'waiting' };
  if (view.state === 'failed') return { state: 'failed', reason: view.reason };
  if (!view.answer.ok) return { state: 'failed', reason: view.answer.reason };
  return { state: 'ready', observedAt: view.answer.data.observedAt, sections: view.answer.data.sections };
}

function model(state: HomeState, views: ReadonlyMap<string, CardView>, notice: HostNotice | null, open: string | null, error?: string): HomeModel {
  const offered = new Map(state.available.map(card => [card.key, card]));
  const opened = open === null ? undefined : offered.get(open);
  return {
    available: state.available,
    pins: state.pins,
    tiles: state.pins.flatMap(key => {
      const page = offered.get(key);
      return page ? [{ key, name: page.name, description: page.description, icon: page.icon }] : [];
    }),
    railPages: state.available.filter(page => page.rail),
    page: opened ? { key: opened.key, name: opened.name, shown: shownOf(views.get(opened.key) ?? { key: opened.key, state: 'waiting' }) } : null,
    notice,
    ...(error ? { error } : {})
  };
}

const EMPTY: HomeState = { available: [], pins: [], cards: [], notice: null };

export function createHomeStore(api: HomeApi | undefined, initial?: { state: HomeState; error?: string }) {
  let state: HomeState = initial?.state ?? EMPTY;
  let error = initial?.error;
  const views = new Map<string, CardView>(state.cards.map(card => [card.key, card]));
  const listeners = new Set<(value: HomeModel) => void>();
  // The extension page on screen, or null.
  let open: string | null = null;
  // Pushes are numbered, so a snapshot read before a push cannot replace it.
  let pushes = 0;
  const pushedAt = new Map<string, number>();
  // The latest notice. Pushes are counted, and a reply only carries the notice
  // when no push has arrived since its request was sent: a reply composed
  // before a newer stop must not hide it (Turing, review of this change).
  let notice: HostNotice | null = state.notice;
  let noticePushes = 0;

  const current = () => model(state, views, notice, open, error);
  const changed = () => { const value = current(); for (const listener of listeners) listener(value); };

  // `asked` is how many pushes had arrived when the request was sent: a card
  // pushed since then is newer than the snapshot's, and is kept.
  function take(reply: unknown, failure: string, asked: number, askedNotice: number): void {
    if (isHomeReply(reply) && reply.ok) {
      state = reply.state;
      if (noticePushes === askedNotice) notice = reply.state.notice;
      for (const card of reply.state.cards) {
        if ((pushedAt.get(card.key) ?? 0) <= asked) views.set(card.key, card);
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
    // Starts listening for pushed cards and reads the state once.
    start(): () => void {
      if (!api) return () => undefined;
      const stopCards = api.onCard(card => {
        if (!isCardView(card)) return;
        pushedAt.set(card.key, ++pushes);
        views.set(card.key, card);
        changed();
      });
      const stopNotices = api.onNotice?.(pushed => {
        if (!isHostNotice(pushed)) return;
        notice = pushed;
        noticePushes += 1;
        changed();
      });
      const stop = () => { stopCards(); stopNotices?.(); };
      const asked = pushes;
      const askedNotice = noticePushes;
      void api.request({ type: 'read' }).then(reply => take(reply, 'Home could not be read.', asked, askedNotice), () => take(undefined, 'Home could not be read.', asked, askedNotice));
      return stop;
    },
    // Which extension page is on screen, or null. Only it is asked for
    // (QGD-HOM-0005).
    openPage(key: string | null): void {
      if (open === key) return;
      open = key;
      changed();
      if (!api) return;
      const asked = pushes;
      const askedNotice = noticePushes;
      void api.request({ type: 'open', key }).then(reply => take(reply, 'The page could not be opened.', asked, askedNotice), () => undefined);
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
