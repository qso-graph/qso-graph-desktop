// SPDX-License-Identifier: GPL-3.0-or-later
// Plain display text and opaque keys exclude both C0 and C1 controls.
export function hasControlCharacters(value: string): boolean {
  for (let at = 0; at < value.length; at++) {
    const code = value.charCodeAt(at);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}
