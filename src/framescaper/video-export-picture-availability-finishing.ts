/* SPDX-License-Identifier: AGPL-3.0-only */

import { videoFrameToSampleFrame, type RationalRate } from '../common/editor/timeline-time.ts';
import { projectTrackFolderMediaStateV12 } from '../common/editor/track-folder-media-runtime.ts';
import { createVisibleVideoTrackPredicate } from '../common/editor/video-track-visibility.js';

type Data = Readonly<Record<string, unknown>>;

/** Choose a picture encoder from the visible programme inside the requested range. */
export function hasVisibleFramescaperExportPicture(
	project: Data,
	kinds: readonly string[],
	range?: Readonly<{ startFrame: number; endFrame: number }>,
): boolean {
	const primary = records(project.sequences, 'finishing picture sequences').find(({ id }) => id === project.primarySequenceId);
	if (!primary) throw new ReferenceError('finishing picture primary sequence is unavailable.');
	const trackIds = new Set(array(primary.trackIds, 'finishing picture sequence track IDs').map(String));
	const clips = new Map(records(project.clips, 'finishing picture clips').map(clip => [String(clip.id), clip]));
	const tracks = records(projectTrackFolderMediaStateV12(project).tracks, 'finishing picture tracks')
		.filter(({ id }) => trackIds.has(String(id)));
	const visible = createVisibleVideoTrackPredicate(tracks);
	const rate = primary.rate as RationalRate;
	const sampleRate = Number(project.sampleRate);
	return tracks.some(track => visible(track) && array(track.clipIds, 'finishing picture track clip IDs')
		.some(id => {
			const clip = clips.get(String(id));
			if (!clip || !kinds.includes(String(clip.kind))) return false;
			if (range === undefined) return true;
			const start = Number(clip.sequenceStartFrame);
			const end = start + Number(clip.sequenceFrameCount);
			return videoFrameToSampleFrame(start, rate, sampleRate) < range.endFrame
				&& videoFrameToSampleFrame(end, rate, sampleRate) > range.startFrame;
		}));
}

function records(value: unknown, name: string): readonly Data[] {
	return array(value, name).map((item) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${name} must contain records.`);
		return item as Data;
	});
}

function array(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}
