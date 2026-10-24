// SPDX-License-Identifier: GPL-3.0-only
// ADIF Lookup: ADIF's own definitions, searched (KI7MT, 2026-10-22). An
// official extension, built in and on by default, which the operator can
// turn off. It holds one grant, reference:read, and the core answers its
// search from reference.sqlite: it opens no store and makes no request to the
// network (QGD-APP-0009).
import type { ExtensionContext } from '../../../packages/extension-api/context.js';
import { listPage, lookupPage } from './page.js';

export function activate(context: ExtensionContext): void {
  context.subscriptions.push(context.pages.register('lookup', async ({ signal, inputs }) => {
    const query = inputs.search;
    if (query === undefined) return lookupPage(undefined, [], new Date());
    // An enumeration's name, as DXCC_Entity_Code or Band, shows that whole
    // list (#58); anything else is searched.
    if (/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(query.trim())) {
      const list = await context.request({ kind: 'adif.list', name: query.trim() }, { signal });
      if (list.ok && list.kind === 'adif.list' && list.list) return listPage(list.list, new Date());
    }
    const reply = await context.request({ kind: 'adif.search', query }, { signal });
    const found = reply.ok && reply.kind === 'adif.search' ? reply.entries
      : !reply.ok ? reply.error : 'ADIF\'s definitions could not be searched just now.';
    return lookupPage(query, found, new Date());
  }));
}
