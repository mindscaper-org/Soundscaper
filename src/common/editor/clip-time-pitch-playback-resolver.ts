/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineClip } from './engine/types.ts';

interface PlaybackCacheEntry<Buffer> {
	readonly audioBuffer?: Buffer | null;
	readonly frameCount: number;
}

interface PlaybackSource<Buffer> {
	readonly buffer: Buffer;
	readonly sourceStartFrame: 0;
	readonly sourceDurationFrames: number;
	readonly reversed: false;
}

/** A loaded graph keeps one generation while the live resolver prepares its successor. */
export function createClipTimePitchPlaybackResolver<Buffer>(
	entries: ReadonlyMap<string, Readonly<{ entry: PlaybackCacheEntry<Buffer> }>>,
	needsRender: (clip: EngineClip) => boolean,
) {
	const descriptor = (entry: PlaybackCacheEntry<Buffer> | undefined): PlaybackSource<Buffer> | null => (
		entry?.audioBuffer ? Object.freeze({
			buffer: entry.audioBuffer,
			sourceStartFrame: 0,
			sourceDurationFrames: entry.frameCount,
			reversed: false,
		}) : null
	);
	const resolve = (clip: EngineClip) => needsRender(clip)
		? descriptor(entries.get(String(clip.id))?.entry) : null;
	return Object.assign(resolve, {
		snapshot() {
			const sources = new Map([...entries].map(([id, value]) => [id, descriptor(value.entry)]));
			return (clip: EngineClip) => needsRender(clip) ? sources.get(String(clip.id)) ?? null : null;
		},
	});
}
