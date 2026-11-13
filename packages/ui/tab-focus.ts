// SPDX-License-Identifier: GPL-3.0-or-later
import { tick } from 'svelte';

export async function focusShownTab(root: ParentNode | undefined): Promise<void> {
  await tick();
  const shown = root?.querySelector<HTMLButtonElement>('[role="tab"][tabindex="0"]');
  shown?.focus({ preventScroll: true });
  shown?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
