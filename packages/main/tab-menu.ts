// SPDX-License-Identifier: GPL-3.0-or-later
import type { MenuItemConstructorOptions } from 'electron';

export const TAB_ACTIONS = ['next', 'previous', 'recent', 'close', 'move-right', 'move-left'] as const;
export type TabAction = (typeof TAB_ACTIONS)[number];

export function isTabAction(value: unknown): value is TabAction {
  return typeof value === 'string' && TAB_ACTIONS.some(action => action === value);
}

// Single-key shortcuts belong to Electron, including Close Tab: a close role
// would close the BrowserWindow before the renderer could ask about drafts.
export function tabMenu(platform: string, send: (action: TabAction) => void): MenuItemConstructorOptions {
  const mac = platform === 'darwin';
  const item = (action: TabAction, label: string, accelerator?: string): MenuItemConstructorOptions => ({
    id: `tab-${action}`, label, ...(accelerator ? { accelerator } : {}), click: () => send(action)
  });
  return { label: 'Tabs', submenu: [
    item('next', 'Next Tab', mac ? 'Command+Alt+Right' : 'Control+PageDown'),
    item('previous', 'Previous Tab', mac ? 'Command+Alt+Left' : 'Control+PageUp'),
    item('recent', 'Previously Shown Tab', 'Control+Tab'),
    item('close', 'Close Tab', 'CmdOrCtrl+W'),
    { type: 'separator' },
    item('move-right', mac ? 'Move Tab Right (⌘K, ⌘⇧→)' : 'Move Tab Right', mac ? undefined : 'Control+Shift+PageDown'),
    item('move-left', mac ? 'Move Tab Left (⌘K, ⌘⇧←)' : 'Move Tab Left', mac ? undefined : 'Control+Shift+PageUp')
  ] };
}
