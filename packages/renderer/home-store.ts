// SPDX-License-Identifier: GPL-3.0-only
// Home's state in the window (QGD-HOM-0001 to QGD-HOM-0006): the cards on
// offer, the pins, and what each pinned card last said.
//
// Everything arriving here is checked before it is kept (QGD-SEC-0006): the
// state against the Home contract, and each pushed card against the card
// shapes. Plain TypeScript, as shell-store.ts is, so a story can make one
// with no window behind it.
import { isCardView, isHomeReply, type AvailableCard, type CardView, type HomeState } from '../main/home-contract.js';
import type { CardShown } from '../ui/home-card.js';

export interface HomeApi {
  request(command: unknown): Promise<unknown>;
  onCard(listener: (card: unknown) => void): () => void;
}

export interface HomeModel {
  readonly available: readonly AvailableCard[];
  readonly pins: readonly string[];
  // The pinned cards some extension offers, in pin order.
  readonly cards: readonly { readonly key: string; readonly name: string; readonly shown: CardShown }[];
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

function model(state: HomeState, views: ReadonlyMap<string, CardView>, error?: string): HomeModel {
  const names = new Map(state.available.map(card => [card.key, card.name]));
  return {
    available: state.available,
    pins: state.pins,
    cards: state.pins.flatMap(key => {
      const name = names.get(key);
      if (name === undefined) return [];
      return [{ key, name, shown: shownOf(views.get(key) ?? { key, state: 'waiting' }) }];
    }),
    ...(error ? { error } : {})
  };
}

const EMPTY: HomeState = { available: [], pins: [], cards: [] };

export function createHomeStore(api: HomeApi | undefined, initial?: { state: HomeState; error?: string }) {
  let state: HomeState = initial?.state ?? EMPTY;
  let error = initial?.error;
  const views = new Map<string, CardView>(state.cards.map(card => [card.key, card]));
  const listeners = new Set<(value: HomeModel) => void>();
  let visible: boolean | undefined;
  // Pushes are numbered, so a snapshot read before a push cannot replace it.
  let pushes = 0;
  const pushedAt = new Map<string, number>();

  const current = () => model(state, views, error);
  const changed = () => { const value = current(); for (const listener of listeners) listener(value); };

  // `asked` is how many pushes had arrived when the request was sent: a card
  // pushed since then is newer than the snapshot's, and is kept.
  function take(reply: unknown, failure: string, asked: number): void {
    if (isHomeReply(reply) && reply.ok) {
      state = reply.state;
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
      const stop = api.onCard(card => {
        if (!isCardView(card)) return;
        pushedAt.set(card.key, ++pushes);
        views.set(card.key, card);
        changed();
      });
      const asked = pushes;
      void api.request({ type: 'read' }).then(reply => take(reply, 'Home could not be read.', asked), () => take(undefined, 'Home could not be read.', asked));
      return stop;
    },
    // Whether Home is on screen. Only then are cards asked for (QGD-HOM-0005).
    setVisible(showing: boolean): void {
      if (!api || visible === showing) return;
      visible = showing;
      const asked = pushes;
      void api.request({ type: 'visible', visible: showing }).then(reply => take(reply, 'Home could not be updated.', asked), () => undefined);
    },
    // The pins, in the operator's order (QGD-HOM-0003).
    savePins(pins: readonly string[]): void {
      if (!api) return;
      const asked = pushes;
      void api.request({ type: 'pin', pins: [...pins] }).then(reply => take(reply, 'The pins could not be saved.', asked), () => take(undefined, 'The pins could not be saved.', asked));
    }
  };
}

export type HomeStore = ReturnType<typeof createHomeStore>;
