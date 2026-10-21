/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection, type RuntimeClipProject } from '../../runtime-clip-projection.ts';
import { createVisibleVideoTrackPredicate } from '../../video-track-visibility.js';
import { resolveVideoExportRange } from '../../video-export.js';

/** Source readiness follows the delivered picture, while audio retains its effect pre-roll inputs. */
export function videoExportSourceInventory(
	project: RuntimeClipProject, requestedRange: unknown, includeAudio: boolean,
): Readonly<{ project: RuntimeClipProject; pictureClipIds: ReadonlySet<string> }> {
	const range = requestedRange === 'project' ? null : resolveVideoExportRange(project, requestedRange);
	const tracks = (project.tracks ?? []) as readonly Readonly<Record<string, unknown>>[];
	const visible = createVisibleVideoTrackPredicate(tracks);
	const pictureOwners = new Set(tracks.filter(track => visible(track))
		.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds.map(String) : []));
	const pictureClipIds = new Set<string>();
	const clips = (project.clips ?? []).filter(clip => {
		if (clip.kind === 'audio') return includeAudio;
		if (clip.kind !== 'video') return true;
		if (!pictureOwners.has(String(clip.id))) return false;
		if (range) {
			const resolved = resolveRuntimeClipProjection(project, clip);
			if (resolved.timelineEndFrame <= range.startFrame || resolved.timelineStartFrame >= range.endFrame) return false;
		}
		pictureClipIds.add(String(clip.id));
		return true;
	});
	return Object.freeze({ project: { ...project, clips }, pictureClipIds });
}
