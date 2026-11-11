/* SPDX-License-Identifier: AGPL-3.0-only */

export interface AutoTuneControlNote {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly pitch: number;
}
export const AUTO_TUNE_MAX_CONTROL_NOTES = 200_000;
// Include cloned schedule packets, interval indexes and overlapping loop windows.
export const AUTO_TUNE_CONTROL_BYTES = AUTO_TUNE_MAX_CONTROL_NOTES * 256;

/** StaffPad's audited pitch ABI admits one octave in either direction. */
export function autoTuneCorrection(midi: number, note: number, amount: number): number {
	return Math.max(-12, Math.min(12, (note - midi) * amount / 100));
}

/** Merge each key's overlapping intervals before processing. A callback checks
 * at most 128 keys with binary searches, including after arbitrary seeks. */
export function createAutoTuneControlLookup(values: readonly AutoTuneControlNote[]): (frame: number, midi: number) => number | null {
	if (!Array.isArray(values) || values.length > AUTO_TUNE_MAX_CONTROL_NOTES) throw new RangeError('Too many Auto-Tune MIDI control notes.');
	const notes = values.map(note => {
		if (!note || !Number.isSafeInteger(note.startFrame) || note.startFrame < 0
			|| !Number.isSafeInteger(note.endFrame) || note.endFrame <= note.startFrame
			|| !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) throw new RangeError('Invalid Auto-Tune MIDI control note.');
		return { ...note };
	}).sort((a, b) => a.startFrame - b.startFrame || a.pitch - b.pitch);
	const keys: Array<Array<{ startFrame: number; endFrame: number }>> = Array.from({ length: 128 }, () => []);
	for (const note of notes) {
		const intervals = keys[note.pitch]!, previous = intervals.at(-1);
		if (previous && previous.endFrame >= note.startFrame) previous.endFrame = Math.max(previous.endFrame, note.endFrame);
		else intervals.push({ startFrame: note.startFrame, endFrame: note.endFrame });
	}
	return (frame, midi) => {
		let target: number | null = null, distance = Infinity;
		for (let pitch = 0; pitch < keys.length; pitch++) {
			const intervals = keys[pitch]!, next = Math.abs(pitch - midi);
			if (next >= distance || !intervals.length) continue;
			let low = 0, high = intervals.length;
			while (low < high) {
				const middle = (low + high) >>> 1;
				if (intervals[middle]!.startFrame <= frame) low = middle + 1; else high = middle;
			}
			if (low > 0 && intervals[low - 1]!.endFrame > frame) {
				target = pitch; distance = next;
			}
		}
		return target;
	};
}
