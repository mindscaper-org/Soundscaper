/* SPDX-License-Identifier: AGPL-3.0-only */

export interface RepeatedSoundOptions {
	readonly similarityThreshold?: number;
}

export interface RepeatedSoundMatch {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly similarity: number;
	readonly original?: boolean;
}

export interface RepeatedSoundResult {
	readonly trackId: string;
	readonly sourceTrackId: string;
	readonly matches: readonly RepeatedSoundMatch[];
}

export const REPEATED_SOUND_MAXIMUM_MATCHES = 10_000;

export function repeatedSoundThreshold(value: unknown = .9): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < .5 || value > 1) {
		throw new RangeError('The similarity threshold must be between 0.5 and 1.');
	}
	return value;
}

/** Prefer the strongest non-overlapping occurrences, reserving the exact example. */
export function selectRepeatedSoundMatches(
	candidates: readonly RepeatedSoundMatch[],
	original?: RepeatedSoundMatch,
): readonly RepeatedSoundMatch[] {
	const selected: RepeatedSoundMatch[] = original ? [{ ...original, original: true }] : [];
	for (const candidate of [...candidates].sort((a, b) => b.similarity - a.similarity || a.startFrame - b.startFrame)) {
		let low = 0, high = selected.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (selected[mid]!.startFrame < candidate.startFrame) low = mid + 1; else high = mid;
		}
		if ((low > 0 && selected[low - 1]!.endFrame > candidate.startFrame)
			|| (low < selected.length && selected[low]!.startFrame < candidate.endFrame)) continue;
		if (selected.length >= REPEATED_SOUND_MAXIMUM_MATCHES) throw new RangeError('Too many repeated sounds; use a longer example or a higher similarity threshold.');
		selected.splice(low, 0, { ...candidate, original: false });
	}
	return selected;
}
