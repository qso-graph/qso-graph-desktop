// SPDX-License-Identifier: GPL-3.0-or-later
export interface ClosingWindow { id: number; close(): void; isDestroyed(): boolean; setEnabled(enabled: boolean): void }
interface CloseEvent { preventDefault(): void }
interface Dependencies<W extends ClosingWindow> {
  windows(): W[];
  ask(window: W): Promise<boolean>;
  stop(): Promise<void>;
  quit(): void;
}

// Electron's native close and every quit route share the same async question.
// Nothing is stopped until the renderer has confirmed all pending saves.
export function createWindowLifecycle<W extends ClosingWindow>(deps: Dependencies<W>) {
  let state: 'idle' | 'asking' | 'stopping' | 'ready' = 'idle';
  const allowed = new Set<number>();
  const pending = new Map<number, Promise<boolean>>();
  const ask = (window: W) => {
    let answer = pending.get(window.id);
    if (!answer) {
      answer = deps.ask(window).then(value => value === true, () => false)
        .finally(() => pending.delete(window.id));
      pending.set(window.id, answer);
    }
    return answer;
  };
  return {
    close: (event: CloseEvent, window: W) => {
      if (state === 'ready' || allowed.delete(window.id)) return;
      event.preventDefault();
      if (state !== 'idle' || pending.has(window.id)) return;
      void ask(window).then(ok => {
        if (!ok || state !== 'idle' || window.isDestroyed()) return;
        allowed.add(window.id); window.close();
      });
    },
    quit: (event: CloseEvent) => {
      if (state === 'ready') return;
      event.preventDefault();
      if (state !== 'idle') return;
      state = 'asking';
      void Promise.all(deps.windows().map(ask)).then(async answers => {
        if (answers.some(answer => !answer)) { state = 'idle'; return; }
        state = 'stopping';
        // The confirmed drafts cannot change while ports/stores finish closing.
        for (const window of deps.windows()) if (!window.isDestroyed()) window.setEnabled(false);
        try { await deps.stop(); }
        finally { state = 'ready'; deps.quit(); }
      }).catch(() => { if (state === 'asking') state = 'idle'; });
    },
    allClosed: () => deps.quit()
  };
}
