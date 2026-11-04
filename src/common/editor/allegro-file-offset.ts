/* SPDX-License-Identifier: AGPL-3.0-only */

/** A track offset moves its conductor events with the note and controller positions. */
export function offsetAllegroTiming<Value extends Readonly<{ frame: number }>>(values: readonly Value[], offset: number): Value[] {
	const shifted = values.map(value => ({ ...value, frame: Math.round(value.frame + offset) })).sort((a, b) => a.frame - b.frame);
	const root = shifted.filter(value => value.frame <= 0).at(-1) ?? shifted[0];
	return [...(root ? [{ ...root, frame: 0 }] : []), ...shifted.filter(value => value.frame > 0)];
}
