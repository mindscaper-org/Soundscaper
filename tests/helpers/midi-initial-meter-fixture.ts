/* SPDX-License-Identifier: AGPL-3.0-only */

/** Raw FF58 order is intentional: a file writer would normalize duplicate declarations. */
export function initialMeterMidi({ obsolete = true, sameMeter = false } = {}): Uint8Array<ArrayBuffer> {
	const body = [
		...(obsolete ? [0, 0xff, 0x58, 4, sameMeter ? 4 : 3, 2, 24, 8] : []),
		0, 0xff, 0x58, 4, 4, 2, 36, 12,
		0, 0x90, 60, 100,
		0x83, 0x60, 0xff, 0x58, 4, 6, 3, 72, 8,
		0x83, 0x60, 0x80, 60, 0,
		0, 0xff, 0x2f, 0,
	];
	return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0,
		0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body]);
}
