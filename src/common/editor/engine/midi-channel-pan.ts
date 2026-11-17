/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiClipData } from '../midi-model.ts';

/** Preserve mono source geometry until authored channel pan requires stereo. */
export function midiBuiltinChannelCount(data: MidiClipData): 1 | 2 {
	return data.interchange?.events.some(event => (event.status & 0xf0) === 0xb0 && event.data[0] === 10 && event.data[1] !== 64) ? 2 : 1;
}

export function midiPanGains(pan: number): readonly [number, number] {
	if (pan === 0) return [1, 0];
	if (pan === 127) return [0, 1];
	const angle = (pan <= 64 ? pan / 128 : .5 + (pan - 64) / 126) * Math.PI / 2;
	return [Math.cos(angle), Math.sin(angle)];
}
