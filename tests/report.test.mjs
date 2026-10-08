// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { markdown, redact, signOff } from '../scripts/report.mjs';

it('P0-local-report: redacts fixture sentinels before reporting failures', () => {
  expect(redact('QG_FAKE_CREDENTIAL_7e1 QG_FAKE_ROSTER_8a2')).toBe('[redacted] [redacted]');
  expect(redact('Bearer abc.def token=opaque password=opaque')).not.toContain('opaque');
});

describe('QGD-TST-0003 sign-off reporting', () => {
  const run = signedOff => markdown({
    sha: 'abc1234', date: '2026-10-07T00:00:00.000Z', os: 'darwin', arch: 'arm64',
    result: 'PASS', partSignOff: signedOff, retries: 0, delta: 'first local run',
    suites: [{ name: 'build', result: 'PASS' }]
  });

  it('reports none when nothing is signed off', () => {
    expect(signOff([])).toContain('Parts signed off: **none**');
    expect(signOff(undefined)).toContain('**none**');
    expect(run([])).toContain('Parts signed off: **none**');
  });

  it('reports what is signed off, by whom and when', () => {
    const line = signOff([{ part: 'P0', id: 'QGD-PRT-0100', by: 'KI7MT', date: '2026-10-07' }]);
    expect(line).toContain('P0 (QGD-PRT-0100) by KI7MT, 2026-10-07');
    expect(line).not.toContain('none');
  });

  it('never says a signed-off Part is pending', () => {
    const report = run([{ part: 'P0', id: 'QGD-PRT-0100', by: 'KI7MT', date: '2026-10-07' }]);
    expect(report).not.toMatch(/sign-?off:\s*\*\*PENDING/i);
    expect(report).toContain('P0 (QGD-PRT-0100)');
  });

  it('separates what is deferred from what is pending', () => {
    const report = run([]);
    expect(report).toContain('Deferred, not pending:');
    expect(report).toContain('QGD-SCP-0004');
    // These became suites; a report that still calls them pending is wrong.
    expect(report).not.toContain('OS-level connection capture');
    expect(report).not.toContain('complete sentinel/artifact scan');
  });

  it('reports every Part signed off, not only the first', () => {
    const line = signOff([
      { part: 'P0', id: 'QGD-PRT-0100', by: 'KI7MT', date: '2026-10-07' },
      { part: 'P1', id: 'QGD-PRT-0101', by: 'KI7MT', date: '2026-10-09' }
    ]);
    expect(line).toContain('P0 (QGD-PRT-0100)');
    expect(line).toContain('P1 (QGD-PRT-0101)');
  });
});
