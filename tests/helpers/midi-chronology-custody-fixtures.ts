/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { writeMidiFile } from '../../src/common/editor/midi-file.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';

export function rawMidi(events: readonly number[] | Uint8Array<ArrayBuffer>, division = 480): Uint8Array<ArrayBuffer> {
	const prefix = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, division >> 8, division & 255,
		77, 84, 114, 107, 0, 0, 0, 0]);
	new DataView(prefix.buffer).setUint32(18, events.length);
	return Uint8Array.from([...prefix, ...events]);
}

export function releaseMidi(zero: boolean): Uint8Array<ArrayBuffer> {
	return rawMidi([0, 255, 81, 3, 0xe4, 0xe1, 0xc0, 0, 144, 60, 100,
		zero ? 0 : 1, 128, 60, 0, zero ? 16 : 15, 255, 47, 0]);
}

export function sustainMidi(order: 'before' | 'after' | 'later'): Uint8Array<ArrayBuffer> {
	const release = order === 'before' ? [0x87, 0x40, 176, 64, 127, 0, 128, 69, 0]
		: [0x87, 0x40, 128, 69, 0, order === 'later' ? 1 : 0, 176, 64, 127];
	return rawMidi([0, 144, 69, 100, ...release, 0x83, order === 'later' ? 0x5f : 0x60, 176, 64, 0, 0, 255, 47, 0]);
}

export function programMidi(delta: number, division = 480): Uint8Array<ArrayBuffer> {
	return rawMidi([0, 192, 5, 0, 144, 60, 100, delta, 192, 10, 0x83, 0x60, 128, 60, 0, 0, 255, 47, 0], division);
}

export function panicMidi(delta: number): Uint8Array<ArrayBuffer> {
	function variable(value: number): number[] {
		const bytes = [value & 127];
		for (value = Math.floor(value / 128); value; value = Math.floor(value / 128)) bytes.unshift((value & 127) | 128);
		return bytes;
	}
	return rawMidi([0, 176, 64, 127, 0, 144, 69, 100, ...variable(delta), 176, 120, 0,
		...variable(16_384 - delta), 176, 64, 0, 0, 255, 47, 0], 32767);
}

export function keyQueueMidi(burst: boolean): Uint8Array<ArrayBuffer> {
	const events = [0, 255, 81, 3, 7, 161, 32];
	if (burst) {
		for (let index = 0; index < 10_000; index++) events.push(0, 144, 60, 90);
		for (let index = 0; index < 10_000; index++) events.push(index === 0 ? 1 : 0, 128, 60, 64);
	} else for (let index = 0; index < 10_000; index++) events.push(0, 144, 60, 90, 1, 128, 60, 64);
	return rawMidi([...events, 0, 255, 47, 0], 32767);
}

export function scopedLyricMidi(): Uint8Array<ArrayBuffer> {
	return writeMidiFile({ sampleRate: 48_000, tempos: [{ frame: 0, bpm: 120 }], signatures: [], tracks: [{ name: 'Scoped lyric', durationFrames: 96_000,
		notes: [{ id: 'n', startFrame: 48_000, durationFrames: 24_000, channel: 2, pitch: 60, velocity: 90 }],
		events: [{ frame: 0, status: 255, metaType: 32, data: [2] }, { frame: 24_000, status: 255, metaType: 5, data: [104, 105] }] }] });
}

export function globalLyricMidi(): Uint8Array<ArrayBuffer> {
	return rawMidi([0, 255, 81, 3, 7, 161, 32, 0, 255, 32, 1, 2, 0, 146, 60, 90,
		0, 255, 5, 2, 104, 105, 0x83, 0x60, 130, 60, 0, 0, 255, 47, 0]);
}

export function midiProject(value: unknown) {
	assert.ok(validateSoundscaperProject(value));
	return value;
}

export function firstMidiClip(value: unknown) {
	const project = midiProject(value);
	const clip = project.clips.find(clip => readMidiClip(clip)); assert.ok(clip);
	assert.ok(clip.kind === 'audio');
	return clip;
}

export function midiNotes(value: unknown) {
	return midiProject(value).clips.flatMap(clip => readMidiClip(clip)?.notes ?? []);
}
