// SPDX-License-Identifier: GPL-3.0-only
// The broker's deadline must outlast the core's, and must not speak of the
// Keychain about a thing that never touches it.
//
// Both halves are controls on a real defect: every command had one 30s
// deadline and the Keychain's words, while reference.rs lets a fetch run for
// 120s. A slow success was discarded and reported as a Keychain prompt nobody
// could find. The 120s is read out of the Rust source here rather than copied,
// so raising it there and not here fails this test instead of quietly
// reintroducing the defect.
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEADLINES, KEYCHAIN_DEADLINE, deadlineFor } from '../packages/callsigns/deadlines.js';

const coreSeconds = async () => {
  const source = await readFile('packages/callsign-core/src/reference.rs', 'utf8');
  // `.connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(120))`
  const connect = source.match(/connect_timeout\(Duration::from_secs\((\d+)\)\)/);
  const total = source.match(/\.timeout\(Duration::from_secs\((\d+)\)\)/);
  expect(connect, 'reference.rs must still declare a connect timeout').not.toBeNull();
  expect(total, 'reference.rs must still declare a total timeout').not.toBeNull();
  return { connect: Number(connect[1]), total: Number(total[1]) };
};

describe('the callsign service deadlines', () => {
  it('gives a reference fetch longer than the core itself will take', async () => {
    const { total } = await coreSeconds();
    const fetch = deadlineFor('fetch-reference');
    expect(fetch.ms, `the core may run for ${total}s, so the broker must wait longer`)
      .toBeGreaterThan(total * 1000);
    // And the reason the number is not simply enormous: a wedged core still
    // has to produce an answer for somebody.
    expect(fetch.ms).toBeLessThan(5 * 60 * 1000);
  });

  it('gives a lookup both of its requests and the operator too', async () => {
    // Summed out of validation.rs, not copied: a lookup is a Keychain read
    // and then the session key and the callsign, each with its own ceiling.
    // Adding a third request there, or raising one, fails this instead of
    // silently overrunning the broker.
    const source = await readFile('packages/callsign-core/src/validation.rs', 'utf8');
    const requests = [...source.matchAll(/\.timeout\(Duration::from_secs\((\d+)\)\)/g)]
      .map(match => Number(match[1]));
    expect(requests.length, 'validation.rs must still declare its request timeouts')
      .toBeGreaterThanOrEqual(2);
    const network = requests.reduce((total, seconds) => total + seconds, 0) * 1000;
    const lookup = deadlineFor('service-lookup');
    expect(lookup.ms, `${network / 1000}s of requests plus the wait for the operator`)
      .toBeGreaterThanOrEqual(network + KEYCHAIN_DEADLINE.ms);
    // And not the Keychain's words, for the same reason as the fetch: by the
    // time this is reached the Keychain has already answered.
    expect(lookup.said.toLowerCase()).not.toContain('keychain');
  });

  it('does not blame the Keychain for a network fetch', () => {
    // QGD-PSN-0013. The defect was the Keychain's words arriving for a fetch
    // that raises no dialog, sending the operator to look for one.
    const fetch = deadlineFor('fetch-reference');
    expect(fetch.said.toLowerCase()).not.toContain('keychain');
    expect(fetch.said.toLowerCase()).not.toContain('dialog');
    expect(fetch.said).toMatch(/reference source/);
  });

  it('still says Keychain for the commands that are the Keychain', () => {
    // Everything not named in the table, which is every credential command.
    for (const type of [
      'list', 'upsert', 'save-credentials', 'status',
      'test-credential', 'delete-credentials', 'export-callsigns'
    ]) {
      expect(deadlineFor(type), `${type} reaches the credential store`).toBe(KEYCHAIN_DEADLINE);
    }
    expect(Object.keys(DEADLINES).sort()).toEqual(['fetch-reference', 'service-lookup', 'update-download', 'update-feed']);
  });

  it('waits past the core\'s own ceilings for updates (updates.rs)', () => {
    const source = readFileSync('packages/callsign-core/src/updates.rs', 'utf8');
    const feed = Number(/Duration::from_secs\((\d+)\)\)\?\s*\.get\(&sources\.feed\)/.exec(source)?.[1]);
    expect(feed).toBeGreaterThan(0);
    expect(DEADLINES['update-feed'].ms).toBeGreaterThan(feed * 1000);
    expect(source).toContain('Duration::from_secs(2 * 60 * 60)');
    expect(DEADLINES['update-download'].ms).toBeGreaterThan(2 * 60 * 60 * 1000);
  });
});
