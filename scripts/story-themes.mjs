// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0007 (P3-stories-themes): every story renders in light and in dark,
// so a component is seen in each before it is accepted.
//
// The gallery offers a theme switch, which is not the same as every story
// having been through it. This walks the built gallery and loads each story
// twice, once per theme.
//
// It reads storybook-static, which scripts/storybook.mjs has already built.
// Building it a second time would double the slowest suite in the run for no
// new information.
import { _electron as electron } from '@playwright/test';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { extname, join, resolve, sep } from 'node:path';

const output = resolve('storybook-static');
const THEMES = ['light', 'dark'];

// The gallery is ES modules, and a module cannot be loaded from file:// — the
// browser refuses it as cross-origin. So it is served, over the loopback
// interface on a port the operating system picks, for the length of this suite
// and from this one directory.
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

async function serveGallery() {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    // Resolved and then checked to be inside the gallery: a served directory
    // is a path traversal waiting to happen, test-only or not.
    const file = resolve(join(output, decodeURIComponent(path === '/' ? '/index.html' : path)));
    if (file !== output && !file.startsWith(output + sep)) {
      response.writeHead(403).end();
      return;
    }
    stat(file).then(info => {
      if (!info.isFile()) throw new Error('not a file');
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(response);
    }).catch(() => response.writeHead(404).end());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

let index;
try {
  index = JSON.parse(await readFile(resolve(output, 'index.json'), 'utf8'));
} catch {
  console.error('No built gallery to check. scripts/storybook.mjs builds it, and must run first.');
  process.exitCode = 1;
}

if (index) {
  const stories = Object.values(index.entries).filter(entry => entry.type === 'story');
  const failures = [];
  let rendered = 0;

  if (!stories.length) {
    failures.push('the built gallery lists no stories, so this checked nothing');
  }

  const { server, origin } = await serveGallery();
  // Electron, not Playwright's Chromium: `npm ci` installs the first and not
  // the second, and nothing in the documented setup fetches browser binaries.
  // scripts/gallery-host.cjs is a window and nothing else.
  const host = await electron.launch({
    args: [resolve('scripts/gallery-host.cjs')],
    cwd: process.cwd(),
    timeout: 30_000
  });
  const page = await host.firstWindow();

  // Anything the story throws while rendering. Storybook renders an error into
  // the page rather than failing the load, so the page's own report is what
  // has to be read.
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });

  try {
    for (const story of stories) {
      for (const theme of THEMES) {
        problems.length = 0;
        // Built by hand rather than with URLSearchParams, which percent-encodes
        // the colon in `theme:dark` — Storybook then does not recognise the
        // global and renders every story in the default theme. The check below
        // caught that, which is what it is for.
        const url = `${origin}/iframe.html?id=${encodeURIComponent(story.id)}` +
          `&viewMode=story&globals=theme:${theme}`;
        await page.goto(url, { waitUntil: 'load' });

        const root = page.locator('#storybook-root');
        try {
          await root.waitFor({ state: 'attached', timeout: 10_000 });
          // Rendered, not merely present: an empty root is a story that threw.
          await page.waitForFunction(() => {
            const node = document.querySelector('#storybook-root');
            return Boolean(node && node.childElementCount > 0);
          }, undefined, { timeout: 10_000 });
        } catch {
          failures.push(`${story.id} in ${theme}: nothing rendered`);
          continue;
        }

        // The control, on every single view rather than once: the theme has to
        // have actually been applied. Without this the run would load each
        // story twice in whatever theme the gallery defaults to and report
        // that both themes passed.
        let applied;
        try {
          await page.waitForFunction(
            wanted => document.documentElement.getAttribute('data-theme') === wanted,
            theme, { timeout: 10_000 }
          );
          applied = theme;
        } catch {
          applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        }
        if (applied !== theme) {
          failures.push(`${story.id}: asked for ${theme}, the page is ${applied ?? 'unthemed'}`);
          continue;
        }

        if (problems.length) {
          failures.push(`${story.id} in ${theme}: ${problems[0]}`);
          continue;
        }
        rendered += 1;
      }
    }
  } finally {
    await host.close().catch(() => {});
    server.close();
  }

  if (failures.length) {
    console.error('Story themes check failed.');
    for (const failure of failures.slice(0, 20)) console.error(`  ${failure}`);
    if (failures.length > 20) console.error(`  …and ${failures.length - 20} more`);
    process.exitCode = 1;
  } else {
    console.log(`Story themes: ${stories.length} stories rendered in ${THEMES.join(' and ')} — ${rendered} views, each confirmed to be in the theme it was asked for: PASS`);
  }
}
