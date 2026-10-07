// SPDX-License-Identifier: GPL-3.0-only
import { expect, it } from 'vitest';
import { redact } from '../scripts/report.mjs';

it('P0-local-report: redacts fixture sentinels before reporting failures', () => {
  expect(redact('QG_FAKE_CREDENTIAL_7e1 QG_FAKE_ROSTER_8a2')).toBe('[redacted] [redacted]');
  expect(redact('Bearer abc.def token=opaque password=opaque')).not.toContain('opaque');
});
