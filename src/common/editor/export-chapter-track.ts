/* SPDX-License-Identifier: AGPL-3.0-only */

export type EmbeddedChapterTrack = 'markers' | 'all-label-tracks' | `label:${string}`;
type Data = Readonly<Record<string, unknown>>;

export function readEmbeddedChapterTrack(value: unknown): EmbeddedChapterTrack | undefined {
	if (value === undefined) return undefined;
	if (value === 'markers' || value === 'all-label-tracks') return value;
	if (typeof value === 'string' && value.startsWith('label:')) {
		const id = value.slice(6);
		if (id && id === id.trim()) return `label:${id}`;
	}
	throw new RangeError('Choose markers or a label track for embedded chapters.');
}

export function readEmbedChapters(value: unknown): boolean | undefined {
	if (value === undefined || typeof value === 'boolean') return value;
	throw new TypeError('Embed chapters must be a boolean.');
}

export function exportChapterLabelTracks(project: Data): readonly Data[] {
	return Array.isArray(project.tracks) ? project.tracks.filter((track): track is Data => (
		track !== null && typeof track === 'object' && !Array.isArray(track) && track.type === 'label'
	)) : [];
}
