/* SPDX-License-Identifier: AGPL-3.0-only */

import { isTakeCompProjectSchema } from './project-schema-version.ts';

/** Take media is editable content before Flatten gives it ordinary clips. */
export function takeCompContentRange(
	project: unknown,
	trackIds?: readonly string[],
): Readonly<{ startFrame: number; endFrame: number }> | null {
	if (!isTakeCompProjectSchema(project) || !project || typeof project !== 'object') return null;
	const groups = (project as Readonly<{ takeGroups?: unknown }>).takeGroups;
	if (!Array.isArray(groups)) return null;
	const selected = trackIds ? new Set(trackIds) : null;
	let startFrame = Number.POSITIVE_INFINITY, endFrame = 0;
	for (const value of groups as readonly unknown[]) {
		if (!value || typeof value !== 'object') continue;
		const group = value as Readonly<{ trackId?: unknown; startSample?: unknown; endSample?: unknown }>;
		if (selected && (typeof group.trackId !== 'string' || !selected.has(group.trackId))) continue;
		if (!Number.isSafeInteger(group.startSample) || Number(group.startSample) < 0
			|| !Number.isSafeInteger(group.endSample) || Number(group.endSample) <= Number(group.startSample)) continue;
		startFrame = Math.min(startFrame, Number(group.startSample));
		endFrame = Math.max(endFrame, Number(group.endSample));
	}
	return endFrame > startFrame ? { startFrame, endFrame } : null;
}
