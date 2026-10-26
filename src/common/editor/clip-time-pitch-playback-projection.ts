/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from './audio-clip-loop.ts';
import {
	brandRuntimeProjectProjection,
	resolveRuntimeClipProjection,
	resolveRuntimeProjectProjection,
	type RuntimeClipProject,
	type RuntimePersistedClip,
	type RuntimeProjectProjection,
} from './runtime-clip-projection.ts';

/** Beat extent owns programme duration; the persisted scalar is only an edit setting. */
export function clipTimePitchPlaybackProjection<Clip extends RuntimePersistedClip>(
	project: RuntimeClipProject,
	clip: Clip,
	source: Readonly<{ sampleRate?: unknown }>,
): Clip {
	if (clip.kind !== 'audio' || clip.anchor !== 'musical' || clip.musicalExtent !== 'beat'
		|| clip.linkPitchAndTempo === true || clip.warpMap != null || readClipLoop(clip)) return clip;
	const resolved = resolveRuntimeClipProjection(project, clip);
	const sourceRate = source.sampleRate;
	if (typeof sourceRate !== 'number' || !Number.isSafeInteger(sourceRate) || sourceRate < 1) {
		throw new RangeError('The musical clip source sample rate is unavailable.');
	}
	const speedRatio = (resolved.sourceDurationFrames / sourceRate)
		/ (resolved.durationFrames / project.sampleRate!);
	if (!Number.isFinite(speedRatio) || speedRatio <= 0) throw new RangeError('Invalid musical clip playback rate.');
	return Object.freeze({ ...clip, ...resolved, speedRatio });
}

/** Publish the same effective scalar to the engine that cache preparation receives. */
export function resolveTimePitchPlaybackProject<Project extends RuntimeClipProject>(
	project: Project,
): RuntimeProjectProjection<Project> {
	const resolved = resolveRuntimeProjectProjection(project);
	if (!Array.isArray(project.sources)) return resolved;
	const sources = new Map<unknown, Readonly<{ sampleRate?: unknown }>>();
	for (const source of project.sources) {
		if (source && typeof source === 'object' && 'id' in source) sources.set(source.id, source);
	}
	let changed = false;
	const clips = resolved.clips.map(clip => {
		const source = sources.get(clip.sourceId);
		const next = source ? clipTimePitchPlaybackProjection(resolved, clip, source) : clip;
		changed ||= next !== clip;
		return next;
	});
	return changed ? brandRuntimeProjectProjection({ ...resolved, clips: Object.freeze(clips) }) : resolved;
}
