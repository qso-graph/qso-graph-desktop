// SPDX-License-Identifier: GPL-3.0-or-later
import { isSavedTabs } from '../main/settings-contract.js';
import type { ShellStore } from './shell-store.js';

// Restore only after a checked catalogue arrives, including a genuinely empty
// one. Serialize writes so a slow answer cannot put an older order back.
export function createTabSession(shell: ShellStore, deps: {
  catalogue(): readonly { key: string; area: string; name: string }[] | undefined;
  write(tabs: readonly string[]): Promise<unknown>;
}) {
  let pending: readonly string[] | undefined;
  let ready = false;
  let last = '';
  let writes = Promise.resolve<unknown>(undefined);
  const stop = shell.subscribe(state => {
    if (!ready) return;
    const key = JSON.stringify(state.tabs);
    if (key === last) return;
    last = key;
    const tabs = [...state.tabs];
    writes = writes.catch(() => undefined).then(() => deps.write(tabs));
    void writes.catch(() => undefined);
  });
  function catalogueChanged(): void {
    const catalogue = deps.catalogue();
    if (!catalogue) return;
    shell.setTabLabels(Object.fromEntries(catalogue.map(page => [`ext:${page.area}`, catalogue.find(head => head.key === page.area)?.name ?? page.name])));
    if (!pending) return;
    shell.restoreTabs(pending, catalogue);
    pending = undefined;
    ready = true;
    // Persist removal of destinations that are no longer available.
    last = '';
    const tabs = [...shell.get().tabs];
    last = JSON.stringify(tabs);
    writes = writes.catch(() => undefined).then(() => deps.write(tabs));
    void writes.catch(() => undefined);
  }
  return {
    restore(value: unknown): void {
      if (!isSavedTabs(value)) return;
      pending = value;
      catalogueChanged();
    },
    catalogueChanged,
    settled: () => writes,
    stop
  };
}
