// SPDX-License-Identifier: GPL-3.0-only
export interface Persona {
  name: string;
  callsign: string;
  start?: string | null;
  end?: string | null;
  providers: Record<string, { username: string }>;
}
export interface Snapshot { personas: Persona[]; active: string | null }
export interface CredentialStatus { stored: boolean; hasUsername: boolean; hasPassword: boolean; hasApiKey: boolean; preferred: 'service' | 'password' | 'api_key'; effective?: 'password' | 'api_key' | null }
export interface CredentialTest { outcome: 'success' | 'rejected' | 'network-error' | 'rate-limited' | 'invalid-response' | 'missing' | 'unsupported' }
export type PersonaCommand =
  | { type: 'list' }
  | { type: 'upsert'; name: string; callsign: string; start?: string; end?: string }
  | { type: 'set-active'; name: string }
  | { type: 'remove-persona'; name: string }
  | { type: 'status'; persona: string; provider: string }
  | { type: 'test-credential'; persona: string; provider: string }
  | { type: 'delete-credentials'; persona: string; provider: string }
  | { type: 'remove-secret'; persona: string; provider: string; field: 'password' | 'api_key' }
  | { type: 'set-preference'; persona: string; provider: string; preferred: 'service' | 'password' | 'api_key' }
  | { type: 'save-credentials'; persona: string; provider: string; credentials: { username?: string; password?: string; apiKey?: string } };
export type PersonaReply = { ok: true; data: Snapshot | CredentialStatus | CredentialTest | null } | { ok: false; error: string };

// The only page allowed to reach the broker, and the only frame of it.
export const RENDERER_URL = 'qg://desktop/index.html';
export function allowsSender(senderFrame: unknown, mainFrame: unknown, url: string | undefined): boolean {
  return senderFrame !== undefined && senderFrame !== null && senderFrame === mainFrame && url === RENDERER_URL;
}

const providers = new Set(['qrz', 'qrz_logbook', 'eqsl', 'lotw', 'hamqth', 'clublog']);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function text(value: unknown, maximum = 128): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f]/.test(value); }
function date(value: unknown): boolean { return value === undefined || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)); }

export function validateCommand(value: unknown): value is PersonaCommand {
  if (!record(value)) return false;
  switch (value.type) {
    case 'list': return keys(value, ['type']);
    case 'upsert': return keys(value, ['type', 'name', 'callsign', 'start', 'end']) && text(value.name) && text(value.callsign, 64) && date(value.start) && date(value.end);
    case 'set-active':
    case 'remove-persona': return keys(value, ['type', 'name']) && text(value.name);
    case 'status':
    case 'test-credential':
    case 'delete-credentials': return keys(value, ['type', 'persona', 'provider']) && text(value.persona) && typeof value.provider === 'string' && providers.has(value.provider);
    case 'remove-secret': return keys(value, ['type', 'persona', 'provider', 'field']) && text(value.persona) && typeof value.provider === 'string' && providers.has(value.provider) && ['password', 'api_key'].includes(value.field as string);
    case 'set-preference': return keys(value, ['type', 'persona', 'provider', 'preferred']) && text(value.persona) && typeof value.provider === 'string' && providers.has(value.provider) && ['service', 'password', 'api_key'].includes(value.preferred as string);
    case 'save-credentials': {
      if (!keys(value, ['type', 'persona', 'provider', 'credentials']) || !text(value.persona) || typeof value.provider !== 'string' || !providers.has(value.provider) || !record(value.credentials) || !keys(value.credentials, ['username', 'password', 'apiKey'])) return false;
      return Object.values(value.credentials).every(item => item === undefined || (typeof item === 'string' && item.length <= 4096));
    }
    default: return false;
  }
}
