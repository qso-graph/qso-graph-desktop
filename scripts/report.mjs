// SPDX-License-Identifier: GPL-3.0-only
export function redact(value) {
  return String(value)
    .replace(/QG_FAKE_(?:CREDENTIAL|ROSTER)_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/((?:token|password|secret|api[-_]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}

// Read from data/part-signoff.json, never hardcoded: the previous version said
// PENDING unconditionally, which stayed wrong once a Part was signed off.
export function signOff(signedOff) {
  const tail = 'A green local run is evidence, not sign-off.';
  if (!Array.isArray(signedOff) || signedOff.length === 0) return `Parts signed off: **none**. ${tail}`;
  const parts = signedOff.map(entry => `${entry.part} (${entry.id}) by ${entry.by}, ${entry.date}`).join('; ');
  return `Parts signed off: **${parts}**. ${tail}`;
}

export function markdown(report) {
  return [
    `# QSO Graph Desktop verify — ${report.sha} — Rust personas Mac preview`,
    '', `${report.date} · ${report.os}/${report.arch}`,
    '', `LOCAL RESULT: **${report.result}**`,
    '', signOff(report.partSignOff),
    '', '| Suite | Result |', '|---|---|',
    ...report.suites.map(suite => `| ${suite.name} | ${suite.result}${suite.blockedBy ? ` — blocked by ${suite.blockedBy}` : ''} |`),
    '', `Regressions: ${report.result === 'PASS' ? '0 observed in local suites' : 'see failed suites'}.`,
    'Budgets: not yet measured; no milestone budget compliance claimed.',
    'Flaky tests: no automatic retries; no retry success is hidden.',
    `Delta: ${report.delta}.`,
    // Deferred and pending are different things, and a report that calls a
    // deferred item pending misreports the plan. Connection capture and the
    // artifact scan were on this list until they became suites above.
    '', 'Deferred, not pending: a second operating system, a CI matrix and a clean VM of',
    'another OS (QGD-SCP-0004); signing and notarization (QGD-SCP-0003).',
    '', 'Pending: dependency audit and SBOM, clean-machine install and uninstall, a public',
    'and full-history secrets scan, and independent review beyond this machine.',
    '', ...report.suites.filter(s => s.result === 'FAIL').flatMap(s => [
      `Failure: ${s.name}`, '```', redact(s.failure || 'No details available.'), '```', ''
    ])
  ].join('\n') + '\n';
}
