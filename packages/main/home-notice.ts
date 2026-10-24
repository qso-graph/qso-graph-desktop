// SPDX-License-Identifier: GPL-3.0-only
// What Home says when the extension host stops (QGD-APP-0022, QGD-APP-0013):
// which extensions it affected, by name, until the operator dismisses it. As
// VS Code says "Extension host terminated unexpectedly" and keeps saying it.
//
// The extensions are named as affected, never as the cause: a host that stops
// takes down everything in it, and which one did it is not known from here.
//
// The notice is data, not a sentence: what happened, when, and the affected
// extensions' names, each bounded as a manifest name is. The window words it
// (packages/renderer/host-notice.ts), so no limit on a sentence's length can drop
// a name. Pure, so all of it is unit tested.

// What a notice needs of the supervisor's status, declared here rather than
// imported, so the window can share these types without the supervisor's.
export interface HostStopStatus {
  readonly host: 'not started' | 'running' | 'restarting' | 'stopped';
  readonly affected: readonly string[];
  readonly stops: number;
  readonly stoppedAt?: string;
}

export type HostNoticeKind = 'restarting' | 'restarted' | 'not restarted';

export interface HostNotice {
  // The stop it is about: dismissing hides this one, and a later stop shows
  // again.
  readonly id: number;
  readonly kind: HostNoticeKind;
  readonly at?: string;
  readonly affected: readonly string[];
}

export function hostNotice(
  status: HostStopStatus, nameOf: (id: string) => string, dismissed: number
): HostNotice | null {
  if (status.stops === 0 || status.stops <= dismissed) return null;
  const kind: HostNoticeKind = status.host === 'stopped' ? 'not restarted'
    : status.host === 'restarting' ? 'restarting' : 'restarted';
  return {
    id: status.stops, kind,
    ...(status.stoppedAt ? { at: status.stoppedAt } : {}),
    affected: status.affected.map(nameOf)
  };
}

// The dismissed count after the operator dismisses stop `id`, or undefined
// when `id` names a stop that has not happened, which is refused rather than
// taken to mean the latest (QGD-SEC-0006). A stop already dismissed stays so.
export function dismiss(dismissed: number, id: number, stops: number): number | undefined {
  if (!Number.isSafeInteger(id) || id < 1 || id > stops) return undefined;
  return Math.max(dismissed, id);
}
