/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../../../i18n/presentation-message.ts';
import { isTakeCompProjectSchema } from '../../../project-schema-version.ts';

/** Channel topology rewrites cannot yet represent a recorded multi-take graph. */
export function assertTakeCompChannelRewriteAllowed(
	project: Readonly<Record<string, unknown>>,
	trackIds: readonly string[],
	copy: object,
): void {
	if (!isTakeCompProjectSchema(project) || !Array.isArray(project.takeGroups)) return;
	const selected = new Set(trackIds);
	const hasTakes = (project.takeGroups as readonly unknown[]).some(value => {
		if (!value || typeof value !== 'object') return false;
		const group = value as Readonly<{ trackId?: unknown; takes?: unknown }>;
		return typeof group.trackId === 'string' && selected.has(group.trackId)
			&& Array.isArray(group.takes) && group.takes.length > 0;
	});
	if (hasTakes) throw createLocalizedError(Error, copy, 'takeCompFlattenBeforeChannelRewrite', undefined,
		{ fallback: 'Flatten the track’s take comp before splitting or merging its channels.' });
}
