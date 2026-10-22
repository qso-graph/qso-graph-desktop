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
import type { PageAnswer } from './pages.js';

export interface Disposable {
  dispose(): void;
}

// Asked by the core for a pinned page's data; the core decides when
// (QGD-HOM-0005). `signal` is aborted when the core no longer wants the
// answer: the page was unpinned, Home was left, or its deadline passed.
// `inputs` holds what the operator typed in the page's fields, each checked
// by its kind by the core (inputs.ts); a field left empty is absent.
export type PageProvider = (request: {
  readonly pageId: string; readonly signal: AbortSignal; readonly inputs: Readonly<Record<string, string>>
}) => Promise<PageAnswer> | PageAnswer;

export interface ExtensionContext {
  readonly extensionId: string;
  // One request to the core. Every request has a deadline; the reply is an
  // ExtensionReply, which says ok or why not.
  request(request: ExtensionRequest, options?: { readonly signal?: AbortSignal }): Promise<ExtensionReply>;
  readonly pages: {
    // Only a page the manifest contributes can be registered.
    register(pageId: string, provider: PageProvider): Disposable;
  };
  // Disposed when the extension is deactivated, as VS Code's are.
  readonly subscriptions: Disposable[];
}

export interface ExtensionModule {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
