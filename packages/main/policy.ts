// SPDX-License-Identifier: GPL-3.0-only
// P0 serves only these bundled files. No directories or external URLs.
export function resourceName(url: string): 'index.html' | 'style.css' | 'app.js' | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'qg:' || parsed.host !== 'desktop' || parsed.search || parsed.username || parsed.password) return undefined;
    if (parsed.pathname === '/index.html') return 'index.html';
    if (parsed.pathname === '/style.css') return 'style.css';
    if (parsed.pathname === '/app.js') return 'app.js';
    return undefined;
  } catch {
    return undefined;
  }
}

export function allowsResource(url: string): boolean {
  return resourceName(url) !== undefined;
}
