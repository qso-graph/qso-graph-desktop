// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { allowsResource } from '../packages/main/policy.js';

describe('P0-local-policy', () => {
  it('allows only the bundled page and stylesheet', () => {
    expect(allowsResource('qg://desktop/index.html')).toBe(true);
    expect(allowsResource('qg://desktop/style.css')).toBe(true);
  });
  it.each([
    'https://example.invalid/', 'http://127.0.0.1:1234/',
    'ws://127.0.0.1:1234/', 'data:text/html,hello', 'javascript:void(0)',
    'file:///index.html', 'not a URL', 'qg://desktop/../main.js',
    'qg://desktop/unknown.txt', 'qg://desktop/index.html?other-file=true',
    'qg://other-host/index.html', 'qg://user:pass@desktop/index.html',
    'qg://desktop/%2e%2e/main.js'
  ])('refuses an unregistered resource (%#)', url => {
    expect(allowsResource(url)).toBe(false);
  });
});
