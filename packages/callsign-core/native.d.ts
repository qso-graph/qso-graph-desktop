// SPDX-License-Identifier: GPL-3.0-only
// The shape of the Rust credential core as napi-rs exposes it.
//
// Without this the addon arrives through createRequire as `any`, and every call
// into the credential core — saveCredentials, requireCredential,
// deleteCredentials — is unchecked. QGD-CRD-0002 makes this the boundary that
// owns the OS credential stores; an untyped boundary is the one place a typo
// reaches a secret.
//
// Kept separate from the callsign contract on purpose. That is the contract
// between the renderer and the broker; this is the contract between the broker's
// utility process and the addon. They look alike today and are free to differ.

export interface NativeProviderRef {
  username: string;
}

// One of the operator's callsigns. `id` is permanent; the call and the
// description may change.
export interface NativeCallsign {
  id: string;
  call: string;
  description: string;
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

// What an import would do, counted and named. No secret: QGD-CRD-0006 holds
// here as everywhere, and an operator deciding whether to import needs the
// names and the numbers, not the values.
export interface NativeImportPreview {
  created: string;
  callsigns: number;
  // Logins in a file from before callsigns and Locations moved without them,
  // which are not imported.
  logins: number;
  arriving: string[];
  // The callsigns on this computer, which a restore removes first.
  here: string[];
  // The Locations, as QG Storage handed them to the export.
  locations: string;
}

// What came back from a reference source. `fresh` false is a 304: the body is
// empty and nothing changed (QGD-REF-0010).
export interface NativeFetchedReference {
  fresh: boolean;
  body: Buffer;
  etag: string | null;
  lastModified: string | null;
}

export interface NativeImportSummary {
  callsigns: number;
  locations: string;
}

export interface NativeLookupField {
  name: string;
  value: string;
}

// QGD-APP-0007 and QGD-PII-0007: a fixed outcome word, and the fields the
// service sent, for display. Never the secret that was used.
export interface NativeLookupResult {
  outcome: string;
  fields: NativeLookupField[];
}

export declare class CallsignCore {
  constructor(directory: string);
  list(): NativeCallsign[];
  create(call: string, description: string, start?: string, end?: string): NativeCallsign;
  update(id: string, call: string, description: string, start?: string, end?: string): NativeCallsign;
  setActive(id: string): void;
  // The active callsign's id.
  active(): string | null;
  saveCredentials(id: string, provider: string, credentials: NativeCredentialInput): void;
  credentialStatus(id: string, provider: string): NativeCredentialStatus;
  deleteCredentials(id: string, provider: string): boolean;
  removeSecret(id: string, provider: string, field: string): void;
  setPreference(id: string, provider: string, preference: string): void;
  removeCallsign(id: string): void;
  testCredential(id: string, provider: string): NativeCredentialTest;
  // Moving callsigns between machines (QGD-PSN-0007 to QGD-PSN-0011). What
  // crosses this boundary is ciphertext: the bundle is built, sealed and
  // dropped inside the core.
  // All of the app's outbound HTTPS goes through this core (D-18, D-31):
  // rustls over AWS-LC in FIPS mode (TLS 1.3, or 1.2 where a public reference
  // source offers nothing newer), not Electron's BoringSSL.
  fetchReference(url: string, etag?: string, lastModified?: string): NativeFetchedReference;
  serviceLookup(id: string, provider: string, operation: string, callsign: string): NativeLookupResult;
  exportCallsigns(passphrase: string, locations: string): Buffer;
  inspectImport(file: Buffer, passphrase: string): NativeImportPreview;
  applyImport(file: Buffer, passphrase: string, replace: boolean): NativeImportSummary;
  // Trusted-core only. The broker never exposes this to a renderer.
  requireCredential(id: string, provider: string, prefer?: string): NativeCredentialInput;
}

export interface NativeModule {
  CallsignCore: typeof CallsignCore;
  initCoreLogging(): void;
  drainCoreLogs(): string[];
}
