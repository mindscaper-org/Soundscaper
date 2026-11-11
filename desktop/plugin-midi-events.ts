/* SPDX-License-Identifier: AGPL-3.0-only */
/** Channel messages only; block offsets and lengths are checked before crossing the ABI. */
export function validatePluginMidiEvents(value: unknown, frames: number): readonly Readonly<{ frame: number; data: readonly number[] }>[] {
	if (!Array.isArray(value) || value.length > 65_536) throw new RangeError('Invalid plug-in MIDI event count.');
	let last = -1;
	return value.map((event: unknown) => {
		if (!event || typeof event !== 'object') throw new TypeError('Invalid plug-in MIDI event.');
		const { frame, data } = event as { frame: number; data: unknown };
		if (!Number.isSafeInteger(frame) || frame < last || frame < 0 || frame >= frames || !Array.isArray(data)
			|| data[0] < 0x80 || data[0] >= 0xf0 || !Number.isInteger(data[0])
			|| data.length !== ([0xc0, 0xd0].includes(data[0] & 0xf0) ? 2 : 3)
			|| data.slice(1).some((byte: unknown) => !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 127)) {
			throw new RangeError('Invalid plug-in MIDI channel message or block offset.');
		}
		last = frame;
		return { frame, data: data as number[] };
	});
}
