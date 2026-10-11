// SPDX-License-Identifier: GPL-3.0-only
// The store a credential is kept in is named for the platform the operator is
// on, and macOS's own wording is left exactly as it was.
import { describe, expect, it } from 'vitest';
import { credentialStore, credentialStoreTitle, forStore } from '../packages/personas/credential-store.js';

describe('the credential store, named for the platform', () => {
  it('names each platform\'s own store', () => {
    expect(credentialStore('darwin')).toBe('Keychain');
    expect(credentialStore('win32')).toBe('Credential Manager');
    expect(credentialStore('linux')).toBe('the keyring');
    expect(credentialStoreTitle('win32')).toBe('Windows Credential Manager');
  });

  it('leaves macOS\'s sentences untouched', () => {
    for (const text of ['Stored in Keychain.', 'Credential saved in macOS Keychain.',
      'Keychain did not respond. Check for a macOS permission dialog, then try again.']) {
      expect(forStore(text, 'darwin')).toBe(text);
    }
  });

  it('says the right store elsewhere, capitalised where a sentence starts', () => {
    expect(forStore('Keychain could not save this credential.', 'win32')).toBe('Credential Manager could not save this credential.');
    expect(forStore('Keychain could not save this credential.', 'linux')).toBe('The keyring could not save this credential.');
    expect(forStore('Stored in Keychain · password.', 'linux')).toBe('Stored in the keyring · password.');
    expect(forStore('Credential saved in macOS Keychain.', 'win32')).toBe('Credential saved in Credential Manager.');
    expect(forStore('Persona was not removed because Keychain could not delete a credential.', 'linux'))
      .toBe('Persona was not removed because the keyring could not delete a credential.');
    // No macOS dialog to look for anywhere else.
    expect(forStore('Keychain did not respond. Check for a macOS permission dialog, then try again.', 'win32'))
      .toBe('Credential Manager did not respond. Try again.');
  });

  it('leaves no Keychain behind off macOS', () => {
    for (const platform of ['win32', 'linux']) {
      expect(forStore('Remove this persona and ALL its saved service credentials from Keychain? This cannot be undone.', platform))
        .not.toMatch(/Keychain|macOS/);
    }
  });
});
