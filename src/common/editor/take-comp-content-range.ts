/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTakeCompProjectSchema } from './project-schema-version.ts';

/** Take media is editable content before Flatten gives it ordinary clips. */
export function takeCompContentRange(
	project: unknown,
	trackIds?: readonly string[],
): Readonly<{ startFrame: number; endFrame: number }> | null {
	let startFrame = Number.POSITIVE_INFINITY, endFrame = 0;
	for (const range of takeCompTrackContentRanges(project, trackIds).values()) {
		startFrame = Math.min(startFrame, range.startFrame); endFrame = Math.max(endFrame, range.endFrame);
	}
	return endFrame > startFrame ? { startFrame, endFrame } : null;
}

/** Keep empty lanes distinguishable from lanes whose editable content is owned takes. */
export function takeCompTrackContentRanges(project: unknown, trackIds?: readonly string[]): ReadonlyMap<string, Readonly<{ startFrame: number; endFrame: number }>> {
	const ranges = new Map<string, Readonly<{ startFrame: number; endFrame: number }>>();
	if (!isTakeCompProjectSchema(project) || !project || typeof project !== 'object') return ranges;
	const groups = (project as Readonly<{ takeGroups?: unknown }>).takeGroups;
	if (!Array.isArray(groups)) return ranges;
	const selected = trackIds ? new Set(trackIds) : null;
	for (const value of groups as readonly unknown[]) {
		if (!value || typeof value !== 'object') continue;
		const group = value as Readonly<{ trackId?: unknown; startSample?: unknown; endSample?: unknown }>;
		if (typeof group.trackId !== 'string' || selected && !selected.has(group.trackId)) continue;
		if (!Number.isSafeInteger(group.startSample) || Number(group.startSample) < 0
			|| !Number.isSafeInteger(group.endSample) || Number(group.endSample) <= Number(group.startSample)) continue;
		const previous = ranges.get(group.trackId);
		ranges.set(group.trackId, { startFrame: Math.min(previous?.startFrame ?? Infinity, Number(group.startSample)),
			endFrame: Math.max(previous?.endFrame ?? 0, Number(group.endSample)) });
	}
	return ranges;
}
