// SPDX-License-Identifier: GPL-3.0-only
// The shape of the Rust credential core as napi-rs exposes it.
//
// Without this the addon arrives through createRequire as `any`, and every call
// into the credential core — saveCredentials, requireCredential,
// deleteCredentials — is unchecked. QGD-CRD-0002 makes this the boundary that
// owns the OS credential stores; an untyped boundary is the one place a typo
// reaches a secret.
//
// Kept separate from persona-contract.ts on purpose. That is the contract
// between the renderer and the broker; this is the contract between the broker's
// utility process and the addon. They look alike today and are free to differ.

export interface NativeProviderRef {
  username: string;
}

export interface NativePersona {
  name: string;
  callsign: string;
  start: string | null;
  end: string | null;
  providers: Record<string, NativeProviderRef>;
}

export interface NativeCredentialInput {
  username?: string | null;
  password?: string | null;
  apiKey?: string | null;
}

export interface NativeCredentialStatus {
  testable: boolean;
  stored: boolean;
  kindsKnown: boolean;
  hasUsername: boolean;
  hasPassword: boolean;
  hasApiKey: boolean;
  preferred: string;
  effective: string | null;
}

export interface NativeCredentialTest {
  outcome: string;
}

export declare class PersonaCore {
  constructor(directory: string);
  list(): NativePersona[];
  upsert(name: string, callsign: string, start?: string, end?: string): NativePersona;
  setActive(name: string): void;
  active(): string | null;
  saveCredentials(persona: string, provider: string, credentials: NativeCredentialInput): void;
  credentialStatus(persona: string, provider: string): NativeCredentialStatus;
  deleteCredentials(persona: string, provider: string): boolean;
  removeSecret(persona: string, provider: string, field: string): void;
  setPreference(persona: string, provider: string, preference: string): void;
  removePersona(name: string): void;
  testCredential(persona: string, provider: string): NativeCredentialTest;
  // Trusted-core only. The broker never exposes this to a renderer.
  requireCredential(persona: string, provider: string, prefer?: string): NativeCredentialInput;
}

export interface NativeModule {
  PersonaCore: typeof PersonaCore;
  initCoreLogging(): void;
  drainCoreLogs(): string[];
}
