// SPDX-License-Identifier: GPL-3.0-or-later
import { isSettingsTab, type SettingsTab } from '../main/settings-contract.js';
import type { ShellStore } from './shell-store.js';

// Match the destination session: no startup write before the saved choice is
// read, and writes are ordered. A choice made during startup wins that race.
export function createSettingsTabSession(shell: ShellStore, write: (tab: SettingsTab) => Promise<unknown>) {
  let ready = false;
  let touched = false;
  let restoring = false;
  let last = shell.get().settingsTab;
  let writes = Promise.resolve<unknown>(undefined);
  function persist(tab: SettingsTab): void {
    writes = writes.catch(() => undefined).then(() => write(tab));
    void writes.catch(() => undefined);
  }
  const stop = shell.subscribe(state => {
    if (restoring) return;
    if (!ready && state.page === 'settings') touched = true;
    if (state.settingsTab === last) return;
    last = state.settingsTab;
    if (!ready) touched = true;
    else persist(last);
  });
  return {
    restore(value: unknown): void {
      if (ready) return;
      if (!touched && isSettingsTab(value)) {
        restoring = true;
        last = value;
        shell.set({ settingsTab: value });
        restoring = false;
      }
      ready = true;
      if (touched && last !== value) persist(last);
    },
    settled: () => writes,
    stop
  };
}
