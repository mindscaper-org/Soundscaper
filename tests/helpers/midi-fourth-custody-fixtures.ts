/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { rawMidi } from './midi-chronology-custody-fixtures.ts';

export function exactWave(name: string, channels: readonly Float32Array[], sampleRate = 48_000): File {
	return new File([Uint8Array.from(encodeWav(Array.from(channels), { sampleRate, bitDepth: 32, float: true, dither: false }))], name, { type: 'audio/wav' });
}

export function fastConductorMidi(): Uint8Array<ArrayBuffer> {
	const name = [...new TextEncoder().encode('Fast')];
	return rawMidi([0, 255, 81, 3, 0, 195, 80, 0, 255, 88, 4, 3, 2, 24, 8,
		0, 255, 3, name.length, ...name, 0, 144, 60, 100, 165, 64, 128, 60, 0, 0, 255, 47, 0]);
}

export function modeReleaseMidi(mode: 'omni' | 'instant', latePedal = false): Uint8Array<ArrayBuffer> {
	return mode === 'omni' ? rawMidi([0, 144, 60, 100, 0x83, 0x60, 176, 124, 0, 0x8b, 0x20, 128, 60, 0, 0, 255, 47, 0])
		: rawMidi([0, 144, 60, 100, 0, 176, 123, 0, ...(latePedal ? [0, 176, 64, 127] : []), 0x8f, 0, 128, 60, 0, 0, 255, 47, 0]);
}

export function conductorLoopMidi(changes: boolean): Uint8Array<ArrayBuffer> {
	return writeMidiFile({ sampleRate: 48_000,
		tempos: [{ frame: 0, bpm: 120 }, ...(changes ? [{ frame: 24_000, bpm: 60 }] : [])],
		signatures: [{ frame: 0, numerator: 4, denominator: 4 }, ...(changes ? [{ frame: 24_000, numerator: 3, denominator: 4 }] : [])],
		tracks: [{ name: 'Meter loop', durationFrames: 96_000, notes: [
			{ id: 'a', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames: 12_000 },
			{ id: 'b', pitch: 64, channel: 0, velocity: 90, startFrame: 72_000, durationFrames: 12_000 },
		] }],
	});
}

export function ordinaryMidi(name = 'Notes', durationFrames = 4800): File {
	return new File([writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name, notes: [
		{ id: 'n', pitch: 60, channel: 0, velocity: 90, startFrame: 0, durationFrames },
	] }] })], `${name}.mid`, { type: 'audio/midi' });
}
