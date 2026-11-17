/* SPDX-License-Identifier: AGPL-3.0-only */

/** Per-port/channel RPN selection and pitch sensitivity survive independent source reads. */
export function createMidiPitchState() {
	let msb = 127, lsb = 127, semitones = 2, cents = 0, bend = 8192, selected = false;
	const ratio = () => 2 ** (((bend - 8192) / 8192 * (semitones + cents / 100)) / 12);
	return { observe(status: number, data: readonly number[]): number | null {
		if ((status & 0xf0) === 0xe0) { bend = data[0]! | data[1]! << 7; return ratio(); }
		switch (data[0]) {
			case 101: msb = data[1]!; selected = true; return null;
			case 100: lsb = data[1]!; selected = true; return null;
			case 99: case 98: selected = false; return null;
			case 121: bend = 8192; msb = lsb = 127; selected = false; return ratio();
		}
		if (!selected || msb !== 0 || lsb !== 0) return null;
		switch (data[0]) {
			case 6: semitones = data[1]!; break;
			case 38: cents = data[1]!; break;
			case 96: semitones = Math.min(127, semitones + 1); break;
			case 97: semitones = Math.max(0, semitones - 1); break;
			default: return null;
		}
		return ratio();
	} };
}
