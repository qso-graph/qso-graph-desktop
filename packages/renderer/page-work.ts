// SPDX-License-Identifier: GPL-3.0-or-later
// A page owns its draft. Only an explicit true confirms that it was saved.
export interface PageWork {
  isDirty(): boolean;
  save(): Promise<boolean>;
  discard(): void;
  reveal?(): void;
}

export type CloseChoice = 'save' | 'discard' | 'cancel';
