/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveSelectionRange } from './selection-range.ts';

export function resolveVampAnalysisSelection(project: unknown, selectedClipId: string | null, durationFrames: number) {
	if (!Number.isSafeInteger(durationFrames) || durationFrames <= 0) return null;
	const range = resolveSelectionRange(project, { selectedClipId });
	return range && range.endFrame <= durationFrames ? range : null;
}
