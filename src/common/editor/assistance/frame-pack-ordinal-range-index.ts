/* SPDX-License-Identifier: AGPL-3.0-only */

/** One source owns ordered pack ranges, one hot range, and binary lookup for nonsequential inference. */
export function createAssistanceFramePackOrdinalRangeIndex<Value extends Readonly<{ ordinalStart: number; frameCount: number }>>(ranges: readonly Value[]): (ordinal: number) => Value {
	let end = 0;
	const entries = ranges.map(value => {
		if (!Number.isSafeInteger(value.ordinalStart) || value.ordinalStart !== end
			|| !Number.isSafeInteger(value.frameCount) || value.frameCount < 1
			|| !Number.isSafeInteger(end + value.frameCount)) throw new RangeError('Frame-pack ordinal ranges must be exact, contiguous and ordered.');
		const start = end; end += value.frameCount;
		return Object.freeze({ start, end, value });
	});
	let current = entries[0];
	return ordinal => {
		if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= end) throw new RangeError('Inference frame ordinal is outside its reviewed pack ranges.');
		if (current && ordinal >= current.start && ordinal < current.end) return current.value;
		let lower = 0; let upper = entries.length;
		while (lower < upper) {
			const middle = lower + Math.floor((upper - lower) / 2);
			if (entries[middle]!.end <= ordinal) lower = middle + 1;
			else upper = middle;
		}
		current = entries[lower]!; return current.value;
	};
}
