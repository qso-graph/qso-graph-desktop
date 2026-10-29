// SPDX-License-Identifier: GPL-3.0-only
// The WSJT-X adapter and the Monitor together (QGD-INT-0022, QGD-INT-0023):
// a session captured from qso-graph-sim, read by the adapter, checked as the
// core checks events, held by the Monitor, and drawn as the core accepts a
// page. Here rather than in either extension, because an extension depends on
// extension-api and ui alone (QGD-REP-0006).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAdapter } from '../extensions/wsjtx/src/adapter.js';
import { createWindow } from '../extensions/monitor/src/window.js';
import { monitorPage } from '../extensions/monitor/src/page.js';
import { validateEvent, validateDelivered, type DeliveredEvent } from '../packages/extension-api/integration-events.js';
import { validatePageAnswer, type PageData, type Section } from '../packages/extension-api/pages.js';

const NOW = Date.parse('2026-10-29T18:43:00Z');
const page = (window: ReturnType<typeof createWindow>, view?: string): PageData => {
  const answer = validatePageAnswer(monitorPage(window, view, NOW));
  if (!answer.ok) throw new Error(answer.reason);
  return answer.data;
};
const table = (data: PageData) => data.sections.find((section): section is Extract<Section, { shape: 'table' }> => section.shape === 'table');

describe('a simulated session, from datagrams to the Monitor\'s page', () => {
  it('draws a session the simulator played, through the adapter, as the core accepts it', () => {
    const capture = (JSON.parse(readFileSync('extensions/wsjtx/tests/fixtures/qso-graph-sim-0.2.0.json', 'utf8')) as { datagrams: string[] })
      .datagrams.map(hex => ({ from: '127.0.0.1:50000', bytes: new Uint8Array(Buffer.from(hex, 'hex')) }));
    // Each as the core checks it, then as the Monitor receives it.
    const events: DeliveredEvent[] = createAdapter().receive(capture).events.map(event => validateDelivered({ ...validateEvent(event), adapter: 'wsjtx' }));
    // The session as it played, up to the Clear it ends with: WSJT-X clears
    // as it closes, and a server then drops its decodes (NetworkMessage.hpp).
    const end = events.findIndex(event => event.type === 'clear');
    expect(end).toBeGreaterThan(0);
    const window = createWindow();
    window.take(events.slice(0, end), NOW);
    const data = page(window);
    expect(data.views!.map(view => view.label)).toEqual(['All', 'WSJT-X']);
    const decodes = table(data)!;
    expect('groups' in decodes && decodes.groups.length).toBeGreaterThan(3);
    // Then the Clear and the Close: nothing is left, and it says so.
    window.take(events.slice(end), NOW);
    const after = page(window);
    expect(table(after)).toBeUndefined();
    expect(after.sections[0]).toMatchObject({ shape: 'figures', figures: expect.arrayContaining([{ label: 'Now', value: 'Closed' }]) });
  });

});
