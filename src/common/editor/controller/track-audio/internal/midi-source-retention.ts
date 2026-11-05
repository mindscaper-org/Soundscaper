/* SPDX-License-Identifier: AGPL-3.0-only */

/** Regeneration retains the entire native source, including trimmed trailing rests. */
export function retainedMidiSourceFrames(
	source: Readonly<{ kind?: unknown; frameCount?: unknown }> | undefined, minimumFrames: number,
): number {
	return source?.kind === 'audio' && Number.isSafeInteger(source.frameCount) && Number(source.frameCount) > 0
		? Math.max(minimumFrames, Number(source.frameCount)) : minimumFrames;
}
