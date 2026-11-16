// SPDX-License-Identifier: GPL-3.0-or-later
// QSO Graph's copy of the pinned files (#213): used only when it gives the
// file pinned, and otherwise the fetch goes to the file's own site.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { REFERENCE_COPY, fromCopy } from '../scripts/reference-copy.mjs';

const file = Buffer.from('ADIF archive bytes');
const pin = createHash('sha256').update(file).digest('hex');
const answer = (status, body = file) => async () => new Response(body, { status });

describe('the reference copy', () => {
  it('asks for the file by its SHA-256, and returns it when it matches', async () => {
    const get = vi.fn(answer(200));
    expect(await fromCopy(pin, { get })).toEqual(file);
    expect(get).toHaveBeenCalledWith(`${REFERENCE_COPY}/${pin}`, expect.anything());
  });

  it('is HTTPS', () => {
    expect(REFERENCE_COPY).toMatch(/^https:\/\/[^/]+$/);
  });

  it.each([
    ['a file that is not the one pinned', answer(200, Buffer.from('something else'))],
    ['a file not there yet', answer(404, '')],
    ['a copy out of reach', async () => { throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }); }]
  ])('gives nothing for %s, so the site is asked', async (_what, get) => {
    expect(await fromCopy(pin, { get })).toBeUndefined();
  });

  it('refuses a pin that is not a SHA-256, rather than asking for it', async () => {
    const get = vi.fn(answer(200));
    await expect(fromCopy('../index.html', { get })).rejects.toThrow(/not a SHA-256/);
    expect(get).not.toHaveBeenCalled();
  });
});
