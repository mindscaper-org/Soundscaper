/* SPDX-License-Identifier: AGPL-3.0-only */

import { audioTrackChannelCount } from './project-audio-factory.js';
import type { DataRecord } from './dawproject-export-context.ts';

/** Reuse the export's existing indexes, preserving strict raw-ID fallback behavior. */
export function createDawprojectAudioWidthReader(
	project: DataRecord, clips: ReadonlyMap<string, DataRecord>, sources: ReadonlyMap<string, DataRecord>,
): (track: DataRecord, fallback: number) => number {
	const canonical = [project.clips, project.sources].every(value => !value || Array.isArray(value)
		&& value.every((item: unknown) => item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'));
	return (track, fallback) => {
		if (!canonical) return audioTrackChannelCount(project, track, fallback) as number;
		if (track.type === 'label') return fallback;
		let width = 0;
		for (const id of (track.clipIds || []) as Iterable<string>) {
			const source = sources.get(clips.get(id)?.sourceId as string);
			if (source) width = Math.max(width, Number(source.channelCount) || 0);
		}
		return width || fallback;
	};
}
