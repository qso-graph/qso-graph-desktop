// SPDX-License-Identifier: GPL-3.0-or-later
// Main's admission and single-flight rule, independent of Electron.
import { isPageActionEvent, permitsPageAction, isPageActionAnswer, type PageActionAnswer, type PageActionEvent, type PageActions } from '../extension-api/actions.js';
import type { PageAnswer } from '../extension-api/pages.js';
export interface PageActionState { readonly key: string; readonly running: boolean; readonly status?: string }
export function createPageActions(deps: {
  current(): { key: string; page: PageActions; answer?: PageAnswer } | undefined;
  run(extension: string, event: PageActionEvent): Promise<PageActionAnswer>;
  refresh(key: string): void;
  publish?(state: PageActionState): void;
}) {
  const running = new Set<string>();
  const states = new Map<string, PageActionState>();
  const publish = (state: PageActionState) => { states.set(state.key, state); deps.publish?.(state); };
  return {
    state(key: string): PageActionState | undefined { return states.get(key); },
    async press(key: string, event: unknown): Promise<PageActionAnswer> {
      const current = deps.current();
      if (!isPageActionEvent(event) || !current || current.key !== key || key.split('/')[1] !== event.page
        || !permitsPageAction(current.page, event, current.answer)) return { ok: false, error: 'That action is not available on the open page.' };
      if (running.has(key)) return { ok: false, error: 'An action is already running on this page.' };
      running.add(key);
      publish({ key, running: true });
      let answer: PageActionAnswer;
      try {
        const result = await deps.run(key.split('/')[0], event);
        answer = isPageActionAnswer(result) ? result : { ok: false, error: 'The action returned a status that could not be read.' };
      } catch { answer = { ok: false, error: 'The action could not finish. Read the page before trying again.' }; }
      finally {
        running.delete(key);
        deps.refresh(key);
      }
      publish({ key, running: false, ...((answer.ok ? answer.status : answer.error) ? { status: answer.ok ? answer.status : answer.error } : {}) });
      return answer;
    }
  };
}
