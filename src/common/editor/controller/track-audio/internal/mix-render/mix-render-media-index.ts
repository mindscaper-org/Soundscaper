/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ControllerProject } from '../../track-domain-types.ts';

/** Keep authored record order while selecting a small render closure by identity. */
function inventory<Value extends Readonly<{ id: string }>>(values: readonly Value[]): (ids: ReadonlySet<string>) => Value[] {
	const records = new Map(values.map((value, index) => [value.id, { value, index }]));
	return ids => [...ids].flatMap(id => {
		const entry = records.get(id); return entry ? [entry] : [];
	}).sort((left, right) => left.index - right.index).map(entry => entry.value);
}

/** Invocation-local indexes retain no authored project beyond the owning operation. */
export function createMixRenderMediaIndex(project: ControllerProject): (trackIds: ReadonlySet<string>) => Pick<ControllerProject, 'tracks' | 'clips' | 'sources'> {
	const tracks = inventory(project.tracks), clips = inventory(project.clips), sources = inventory(project.sources);
	return trackIds => {
		const selectedTracks = tracks(trackIds).filter(track => track.type === 'audio');
		const selectedClips = clips(new Set(selectedTracks.flatMap(track => track.clipIds ?? [])));
		return { tracks: selectedTracks, clips: selectedClips, sources: sources(new Set(selectedClips.map(clip => clip.sourceId))) };
	};
}
