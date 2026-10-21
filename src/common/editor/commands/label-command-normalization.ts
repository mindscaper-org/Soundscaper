/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLabel } from '../project-media-factory.ts';

/** Keep command coordinates until the owning reconciler writes authoritative beats. */
export function normalizeCommandLabel(value: Record<string, unknown>): Record<string, unknown> {
	const label = createLabel(value);
	return value.anchor === 'musical' && value.coordinateDomain === 'resolved-samples'
		? { ...label, startFrame: value.startFrame, endFrame: value.endFrame, coordinateDomain: value.coordinateDomain }
		: label;
}
