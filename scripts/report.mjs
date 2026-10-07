// SPDX-License-Identifier: GPL-3.0-only
export function redact(value) {
  return String(value)
    .replace(/QG_FAKE_(?:CREDENTIAL|ROSTER)_[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/((?:token|password|secret|api[-_]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}

export function markdown(report) {
  return [
    `# QG Desktop verify — ${report.sha} — Rust personas Mac preview`,
    '', `${report.date} · ${report.os}/${report.arch}`,
    '', `LOCAL RESULT: **${report.result}**`,
    '', 'Part sign-off: **PENDING** (local preview is not Part completion).',
    '', '| Suite | Result |', '|---|---|',
    ...report.suites.map(suite => `| ${suite.name} | ${suite.result} |`),
    '', `Regressions: ${report.result === 'PASS' ? '0 observed in local suites' : 'see failed suites'}.`,
    'Budgets: not yet measured; no milestone budget compliance claimed.',
    'Flaky tests: no automatic retries; no retry success is hidden.',
    `Delta: ${report.delta}.`,
    '', 'Pending: three-OS CI evidence, packaged smoke on each OS, OS-level connection capture,',
    'complete sentinel/artifact scan, dependency audit/SBOM, clean-VM install/uninstall,',
    'public/history scan, independent reviews and Judge sign-off. Release signing is deferred.',
    '', ...report.suites.filter(s => s.result === 'FAIL').flatMap(s => [
      `Failure: ${s.name}`, '```', redact(s.failure || 'No details available.'), '```', ''
    ])
  ].join('\n') + '\n';
}
