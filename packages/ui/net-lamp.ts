// SPDX-License-Identifier: GPL-3.0-only
// The Internet lamp's state (QGD-HOM-0005; KI7MT, 2026-10-23). It says what
// is known and no more: the operating system's word that there is no network
// is certain, but its word that there is one means only a link, so green
// needs a request that got through, and one that could not connect is
// yellow. Nothing is asked to find out.
export type Lamp = 'off' | 'trouble' | 'on';

export function lampState(online: boolean | undefined, reached: boolean | null | undefined): Lamp {
  if (online === false) return 'off';
  return reached === false ? 'trouble' : 'on';
}

// In words, for its tooltip and a screen reader: the dot is colour alone.
export function lampWords(lamp: Lamp): string {
  if (lamp === 'off') return 'Internet: offline';
  if (lamp === 'trouble') return 'Internet: on a network, but the last request could not get through';
  return 'Internet: online';
}
