// SPDX-License-Identifier: GPL-3.0-only
// What the operating system calls the store credentials are kept in, so every
// message names the store the operator actually has: Keychain on macOS,
// Credential Manager on Windows, the keyring (the Secret Service) on Linux.
// The credential core and the screens were written for macOS; their sentences
// say "Keychain", and this is the one place that turns that into the right name.
export function credentialStore(platform: string): string {
  if (platform === 'darwin') return 'Keychain';
  if (platform === 'win32') return 'Credential Manager';
  return 'the keyring';
}

// The store's name as a heading, with the system it belongs to.
export function credentialStoreTitle(platform: string): string {
  if (platform === 'darwin') return 'macOS Keychain';
  if (platform === 'win32') return 'Windows Credential Manager';
  return 'System keyring';
}

// Where to look for a callsign's entries, in the tool each platform has
// (QGD-CRD-0003, QGD-CRD-0014). Every entry's account starts with the
// callsign's id; on Windows the keyring crate writes the target as
// account.service.
export function findInStore(platform: string): string {
  if (platform === 'darwin') return 'In Keychain Access, search io.qso-graph.desktop: this callsign\'s entries start with this ID.';
  if (platform === 'win32') return 'In Credential Manager, under Windows Credentials, this callsign\'s entries start with this ID and end in io.qso-graph.desktop.';
  return 'In your keyring\'s manager (Passwords and Keys), search io.qso-graph.desktop: this callsign\'s entries start with this ID.';
}

// A sentence written for macOS, said for this platform. Unchanged on macOS.
export function forStore(text: string, platform: string): string {
  if (platform === 'darwin') return text;
  const store = credentialStore(platform);
  return text
    .replace(/macOS Keychain/g, store)
    .replace(/\bKeychain\b/g, store)
    .replace(/Check for a macOS permission dialog, then try again\./g, 'Try again.')
    .replace(/(^|[.!?]\s+)the keyring/g, (_match, start: string) => `${start}The keyring`);
}
