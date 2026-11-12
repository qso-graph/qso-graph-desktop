// SPDX-License-Identifier: GPL-3.0-or-later
import type { PageWork } from './page-work.js';

// The shell retains this draft while the area's Settings view is unmounted.
// Wrap the plain object in $state at its owner, as with other Svelte models.
export interface AreaWork extends PageWork {
  chosen: readonly string[] | undefined;
  dirty: boolean;
  choose(next: readonly string[]): void;
}
export function createAreaWork(save: (area: readonly string[]) => Promise<boolean>): AreaWork {
  return {
    chosen: undefined,
    dirty: false,
    choose(next) { this.chosen = next; this.dirty = true; },
    isDirty() { return this.dirty; },
    async save() {
      if (!this.dirty) return true;
      if (!this.chosen) return false;
      const saving = [...this.chosen];
      if (await save(saving) !== true || JSON.stringify(saving) !== JSON.stringify(this.chosen)) return false;
      this.dirty = false;
      return true;
    },
    discard() { this.chosen = undefined; this.dirty = false; }
  };
}
