/* SPDX-License-Identifier: AGPL-3.0-only */

import { useSyncExternalStore } from 'react';
import { subscribeTimelineLabelFonts, timelineLabelFontRevision } from './label-layout-preparation.ts';

/** Font completion must update both the track's height and its visible label rows. */
export function useTimelineLabelFontRevision(): number {
	return useSyncExternalStore(subscribeTimelineLabelFonts, timelineLabelFontRevision, timelineLabelFontRevision);
}
