/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { selectFramescaperMulticameraRuntimeSequence } from './editor-project-sequence-multicam.ts';

type Data = Readonly<Record<string, unknown>>;

/** Match the current camera authority without replacing the authored output clip. */
export function resolveFramescaperSelectedFreezeSourceIdFinishing(project: Data, clipId: string): unknown {
	const clip = records(project.clips).find(value => value.id === clipId);
	if (!clip) return null;
	const group = records(project.multicameraGroups).find(value => value.outputClipId === clipId);
	if (!group) return clip.sourceId;
	return selectFramescaperMulticameraRuntimeSequence(FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		project, project.multicameraGroups, {
			projectId: project.id, projectRevision: project.revision,
			groupId: group.id, sequenceId: clip.sequenceId, outputClipId: clipId,
			activeMemberId: group.activeMemberId,
		}).sourceId;
}

function records(value: unknown): readonly Data[] {
	return Array.isArray(value) ? value.filter((entry): entry is Data => entry !== null
		&& typeof entry === 'object' && !Array.isArray(entry)) : [];
}
