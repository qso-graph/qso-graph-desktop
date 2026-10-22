// SPDX-License-Identifier: GPL-3.0-only
// QGD-SEC-0009: a page is opened in the browser only from data/links.json, by
// a name or a reference in its list's form. QGD-FRM-0015: Help's documents
// are the repository's own files, one place each.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCUMENTS, LinkRegisterError, linkFor, validateLinkCommand, validateLinkRegister } from '../packages/main/links-contract.js';

const raw = JSON.parse(readFileSync('data/links.json', 'utf8'));
const register = validateLinkRegister(raw);

describe('the link register (QGD-SEC-0009)', () => {
  it('opens each of Help\'s documents from the repository, and each file exists', () => {
    for (const name of DOCUMENTS) {
      const url = linkFor(register, { type: 'document', name });
      expect(url.startsWith('https://github.com/qso-graph/qso-graph-desktop/blob/')).toBe(true);
      expect(existsSync(register.documents.pages[name]), register.documents.pages[name]).toBe(true);
    }
  });

  it('opens a park on POTA and a summit on SOTA', () => {
    expect(linkFor(register, { type: 'reference', kind: 'pota', reference: 'US-0001' })).toBe('https://pota.app/#/park/US-0001');
    expect(linkFor(register, { type: 'reference', kind: 'sota', reference: 'W7I/SI-001' }))
      .toBe('https://www.sotadata.org.uk/en/summit/W7I/SI-001');
  });

  it.each([
    ['a plain http page', { ...raw, references: { ...raw.references, pota: 'http://pota.app/#/park/{reference}' } }],
    ['credentials in a URL', { ...raw, documents: { ...raw.documents, base: 'https://user:pass@github.com/' } }],
    ['a template without its reference', { ...raw, references: { ...raw.references, sota: 'https://www.sotadata.org.uk/' } }],
    ['a document that is a path', { ...raw, documents: { ...raw.documents, pages: { ...raw.documents.pages, privacy: '../x' } } }],
    ['a missing document', { ...raw, documents: { ...raw.documents, pages: { privacy: 'PRIVACY.md' } } }]
  ])('refuses a register with %s', (_what, value) => {
    expect(() => validateLinkRegister(value)).toThrow(LinkRegisterError);
  });
});

describe('a link command is a name or a reference in its form, never a URL', () => {
  it.each([
    [{ type: 'document', name: 'privacy' }, true],
    [{ type: 'document', name: 'readme' }, false],
    [{ type: 'document', name: 'privacy', url: 'https://example.com/' }, false],
    [{ type: 'reference', kind: 'pota', reference: 'US-0001' }, true],
    [{ type: 'reference', kind: 'pota', reference: 'US-0001@US-ID' }, false],
    [{ type: 'reference', kind: 'pota', reference: 'US-0001/../x' }, false],
    [{ type: 'reference', kind: 'sota', reference: 'W7I/SI-001' }, true],
    [{ type: 'reference', kind: 'sota', reference: 'W7I/SI-001?x=1' }, false],
    [{ type: 'reference', kind: 'wwff', reference: 'KFF-0001' }, false],
    [{ type: 'url', url: 'https://example.com/' }, false],
    ['https://example.com/', false]
  ])('%j → %s', (command, accepted) => {
    expect(validateLinkCommand(command)).toBe(accepted);
  });
});
