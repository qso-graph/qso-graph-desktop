// SPDX-License-Identifier: GPL-3.0-only
// Types for showcase.js, which the stories import.
import type { StationsView } from '../packages/storage/station-contract.js';
import type { ImportPreview } from '../packages/callsigns/callsign-contract.js';

export declare const showcase: unknown;
export declare function showcaseCallsign(): { id: string; label: string } | undefined;
export declare function showcaseStations(): StationsView | undefined;
export declare function showcasePreview(): ImportPreview | undefined;
