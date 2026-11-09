// SPDX-License-Identifier: GPL-3.0-or-later
import type { NativeLotwCommand, NativeLotwPreview, NativeLotwSummary } from '../callsign-core/native.js';
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: unknown, fields: string[]): v is Record<string, unknown> => record(v) && Object.keys(v).length === fields.length && fields.every(f => Object.hasOwn(v, f));
const string = (v: unknown): v is string => typeof v === 'string' && v.length <= 4096;
const id = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const count = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function isLotwCommand(v: unknown): v is NativeLotwCommand {
  if (!record(v)) return false;
  switch (v.op) {
    case 'discard': return exact(v, ['op']);
    case 'inspect': return exact(v, ['op', 'path', 'format']) && string(v.path) && v.path.length > 0 && !v.path.includes('\0') && ['certificate', 'backup'].includes(v.format as string);
    case 'inspectDelete': return exact(v, ['op', 'certificate']) && typeof v.certificate === 'string' && v.certificate.startsWith('cert:') && id(v.certificate.slice(5));
    case 'unlock': return exact(v, ['op', 'token', 'index', 'password']) && id(v.token) && count(v.index) && string(v.password) && new TextEncoder().encode(v.password).length <= 1024;
    case 'cancel':
    case 'commit': return exact(v, ['op', 'token']) && id(v.token);
    default: return false;
  }
}
function entries(v: unknown): boolean {
  return Array.isArray(v) && v.length <= 2048 && v.every(c => exact(c, ['call', 'serial', 'disposition', 'reason', 'fileHasKey', 'keyPresent', 'needsPassword', 'dxcc', 'qsoFirst', 'qsoLast', 'validFrom', 'validTo'])
    && [c.call, c.serial, c.reason, c.qsoFirst, c.qsoLast, c.validFrom, c.validTo].every(string)
    && ['new', 'present', 'refused', 'delete'].includes(c.disposition as string)
    && [c.fileHasKey, c.keyPresent, c.needsPassword].every(b => typeof b === 'boolean') && count(c.dxcc));
}
export function isLotwPreview(v: unknown): v is NativeLotwPreview {
  return exact(v, ['token', 'needsPassword', 'certificates', 'roots', 'locations', 'signedQsos', 'signedQsoBytes'])
    && id(v.token) && typeof v.needsPassword === 'boolean' && entries(v.certificates)
    && count(v.signedQsos) && count(v.signedQsoBytes)
    && Array.isArray(v.roots) && v.roots.length <= 128 && v.roots.every(r => exact(r, ['fingerprint']) && typeof r.fingerprint === 'string' && r.fingerprint.split(':').length === 32 && r.fingerprint.split(':').every(part => /^[A-F0-9]{2}$/.test(part)))
    && Array.isArray(v.locations) && v.locations.length <= 4096 && v.locations.every(l => exact(l, ['name', 'fields']) && string(l.name)
      && Array.isArray(l.fields) && l.fields.length <= 32 && l.fields.every(f => exact(f, ['name', 'value']) && string(f.name) && string(f.value)));
}
// "conflict": the store changed after the operator confirmed, and the
// credential core committed nothing. It is a result the core returns, never
// error text, and it carries nothing but its status.
export function isLotwSummary(v: unknown): v is NativeLotwSummary {
  if (!exact(v, ['status', 'certificates', 'roots', 'signedQsos', 'deleted'])) return false;
  if (v.status === 'conflict') return Array.isArray(v.certificates) && v.certificates.length === 0 && v.roots === 0 && v.signedQsos === 0 && v.deleted === 0;
  return v.status === 'completed' && entries(v.certificates) && [v.roots, v.signedQsos, v.deleted].every(count);
}
