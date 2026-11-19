/* SPDX-License-Identifier: AGPL-3.0-only */
export interface MidiChasedProgram { readonly msb: number; readonly lsb: number; readonly program: number }
const DEFAULT_PROGRAM: MidiChasedProgram = { msb: 0, lsb: 0, program: 0 };
const equal = (a: MidiChasedProgram, b: MidiChasedProgram) => a.msb === b.msb && a.lsb === b.lsb && a.program === b.program;

/** Bank selection waits for program change; sounding voices retain their onset patch. */
export function createMidiChasedPrograms() {
	const channels = Array.from({ length: 16 }, () => ({ msb: 0, lsb: 0, active: DEFAULT_PROGRAM }));
	const replayed = new Map<number, MidiChasedProgram>();
	function select(channel: number, patch: MidiChasedProgram): readonly number[][] {
		if (equal(replayed.get(channel) ?? channels[channel]!.active, patch)) return [];
		replayed.set(channel, patch);
		return [[0xb0 | channel, 0, patch.msb], [0xb0 | channel, 32, patch.lsb], [0xc0 | channel, patch.program]];
	}
	return {
		observe(bytes: readonly number[]): void {
			const channel = channels[bytes[0]! & 15]!;
			if ((bytes[0]! & 240) === 0xb0) {
				if (bytes[1] === 0) channel.msb = bytes[2]!;
				if (bytes[1] === 32) channel.lsb = bytes[2]!;
			} else if ((bytes[0]! & 240) === 0xc0) channel.active = { msb: channel.msb, lsb: channel.lsb, program: bytes[1]! };
		},
		capture(channel: number): MidiChasedProgram { return channels[channel]!.active; },
		select,
		restore(): readonly number[][] {
			const output: number[][] = [];
			for (const channel of replayed.keys()) {
				const state = channels[channel]!;
				output.push(...select(channel, state.active), [0xb0 | channel, 0, state.msb], [0xb0 | channel, 32, state.lsb]);
			}
			return output;
		},
	};
}
