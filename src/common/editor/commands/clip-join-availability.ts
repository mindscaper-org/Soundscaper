/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection, type RuntimeClipProject, type RuntimePersistedClip } from '../runtime-clip-projection.ts';

/** Resolve only selected media before the existing lossless Join admission. */
export function clipJoinAvailabilityProject(
	project: RuntimeClipProject & { readonly clips: readonly RuntimePersistedClip[] },
	clipIds: readonly string[],
) {
	const selected = new Set(clipIds);
	const clips = project.clips.map(clip => typeof clip.id === 'string' && selected.has(clip.id)
		&& clip.kind === 'audio' && clip.anchor === 'musical'
		? resolveRuntimeClipProjection(project, clip) : clip);
	return { ...project, clips };
}
