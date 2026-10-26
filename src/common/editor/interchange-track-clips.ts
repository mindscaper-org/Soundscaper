/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, type createDeliveryReport } from './delivery-report.ts';

/** Keep unresolved authoring references visible in the delivery report. */
export function interchangeTrackClips(
	track: Readonly<Record<string, unknown>>,
	clips: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
	draft: ReturnType<typeof createDeliveryReport>,
	format: 'otio' | 'fcpxml',
): Readonly<Record<string, unknown>>[] {
	const resolved: Readonly<Record<string, unknown>>[] = [];
	for (const id of Array.isArray(track.clipIds) ? track.clipIds as unknown[] : []) {
		const clipId = String(id);
		const clip = clips.get(clipId);
		if (clip) resolved.push(clip);
		else addDeliveryReportItem(draft, {
			code: `${format}.clip-reference-missing`,
			disposition: 'missing', severity: 'error',
			scope: { kind: 'track', id: String(track.id) },
			data: { clipId },
			message: 'The track references a clip the project does not contain.',
		});
	}
	return resolved;
}
