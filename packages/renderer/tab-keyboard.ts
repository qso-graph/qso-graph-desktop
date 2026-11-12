// SPDX-License-Identifier: GPL-3.0-or-later
import { isTabAction } from '../main/tab-menu.js';
import { shownTab, type ShellStore } from './shell-store.js';

// Native accelerators remain available in forms, as in VS Code. Only the
// two-key macOS chord is interpreted here, outside text entry and modals.
export function createTabKeyboard(shell: ShellStore, deps: {
  platform: string;
  focusShown(): Promise<void>;
  blocked(): boolean;
  editing(): boolean;
  now(): number;
}) {
  let chordUntil = 0;
  const reset = () => { chordUntil = 0; };

  async function action(value: unknown): Promise<void> {
    reset();
    if (!isTabAction(value) || deps.blocked() || shell.get().closeQuestion !== null) return;
    const state = shell.get();
    const current = shownTab(state);
    const index = state.tabs.indexOf(current);
    if (index < 0) return;
    if (value === 'close') {
      if (!await shell.closeTab(current)) return;
    } else if (value === 'recent') {
      const recent = state.tabMru.find(id => id !== current && state.tabs.includes(id));
      if (recent) shell.showTab(recent);
    } else if (value === 'next' || value === 'previous') {
      const offset = value === 'next' ? 1 : -1;
      shell.showTab(state.tabs[(index + offset + state.tabs.length) % state.tabs.length]);
    } else {
      const neighbour = state.tabs[index + (value === 'move-right' ? 1 : -1)];
      if (neighbour) shell.reorderTab(current, neighbour);
    }
    await deps.focusShown();
  }

  function keydown(event: KeyboardEvent): void {
    if (deps.platform !== 'darwin') return;
    if (event.defaultPrevented || event.isComposing || event.repeat || deps.blocked() || deps.editing()) { reset(); return; }
    if (['Meta', 'Shift', 'Control', 'Alt'].includes(event.key)) return;
    const pending = chordUntil > deps.now();
    reset();
    if (event.metaKey && !event.ctrlKey && !event.altKey) {
      if (!event.shiftKey && event.key.toLowerCase() === 'k') {
        chordUntil = deps.now() + 1500;
        event.preventDefault();
      } else if (pending && event.shiftKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        event.preventDefault();
        void action(event.key === 'ArrowRight' ? 'move-right' : 'move-left');
      }
    }
  }
  return { action, keydown, reset };
}
