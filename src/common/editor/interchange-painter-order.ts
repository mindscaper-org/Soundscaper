/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native picture tracks are foreground-first; interchange stacks paint bottom-to-top. */
export function interchangePainterOrder<Track extends Readonly<{ type?: unknown }>>(
	tracks: readonly Track[],
): readonly Track[] {
	const picture = tracks.filter(track => track.type === 'video').reverse();
	let index = 0;
	return tracks.map(track => track.type === 'video' ? picture[index++]! : track);
}
