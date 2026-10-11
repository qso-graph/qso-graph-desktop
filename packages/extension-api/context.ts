// SPDX-License-Identifier: GPL-3.0-only
// What an extension's code is given when it is activated, and what it must
// export (QGD-APP-0020). This is the whole of what an extension can reach.
//
// It follows VS Code: an extension's `main` module exports `activate(context)`
// and may export `deactivate()`, and everything it does to the core goes
// through `context`. Here `context` holds message wrappers and disposables
// only (QGD-APP-0003): never a core object, a path, or anything that reaches
// past the broker. Calling `context.request` sends a message on the
// extension's own channel, which the broker has bound to this extension alone
// (QGD-APP-0018), so there is no identifier to claim.
import type { ExtensionReply, ExtensionRequest } from './api-contract.js';
import type { CardAnswer } from './cards.js';

export interface Disposable {
  dispose(): void;
}

// Asked by the core for a pinned card's data; the core decides when
// (QGD-HOM-0005). `signal` is aborted when the core no longer wants the
// answer: the card was unpinned, Home was left, or its deadline passed.
export type CardProvider = (request: { readonly cardId: string; readonly signal: AbortSignal }) => Promise<CardAnswer> | CardAnswer;

export interface ExtensionContext {
  readonly extensionId: string;
  // One request to the core. Every request has a deadline; the reply is an
  // ExtensionReply, which says ok or why not.
  request(request: ExtensionRequest, options?: { readonly signal?: AbortSignal }): Promise<ExtensionReply>;
  readonly cards: {
    // Only a card the manifest contributes can be registered.
    register(cardId: string, provider: CardProvider): Disposable;
  };
  // Disposed when the extension is deactivated, as VS Code's are.
  readonly subscriptions: Disposable[];
}

export interface ExtensionModule {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
