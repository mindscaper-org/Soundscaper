/* SPDX-License-Identifier: AGPL-3.0-only */

import { scaleSampleFrame } from '../../../timeline-time.ts';
import { freezeProjectImportOptions, type NormalizedProjectImportOptions } from './project-import-options.ts';

/** Companion recordings belong to the newly opened project, at the same elapsed drop time. */
export function legacyAupImportPlacement(
	options: Readonly<NormalizedProjectImportOptions>,
	outgoingSampleRate: number,
	incomingSampleRate: number,
): Readonly<NormalizedProjectImportOptions> {
	const placement: Record<string, unknown> = { ...options };
	delete placement.trackIndex;
	delete placement.trackPlacement;
	return freezeProjectImportOptions({
		...placement,
		destination: options.destination,
		trackId: null,
		timelineStartFrame: scaleSampleFrame(options.timelineStartFrame, outgoingSampleRate, incomingSampleRate, 'point'),
	}, Boolean(options.timelineStartExplicit));
}
