// SPDX-License-Identifier: GPL-3.0-only
// Who built QSO Graph Desktop, for Help → Contributors (QGD-FRM-0015). One
// place: adding someone is a line here. KI7MT decides who is on it: those who
// have made a meaningful contribution (KI7MT, 2026-10-22). Outside
// contributors are also credited in the changelog, and their commits kept.
export interface Contributor {
  name: string;
  role: string;
}

export const CONTRIBUTORS: readonly Contributor[] = [
  { name: 'KI7MT', role: 'Creator: design, direction, testing and sign-off.' },
  { name: 'Claude Code (Anthropic)', role: 'AI coding agents: specification, code, tests and review.' },
  { name: 'Codex (OpenAI)', role: 'AI coding agents: review and code.' }
];
