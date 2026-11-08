/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiControllerPcmFixture } from './helpers/midi-controller-pcm-fixture.ts';
import { readMidiClip, type MidiNote } from '../src/common/editor/midi-model.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';

function channelModeFile(mode: number, sustain: boolean): File {
	const track = [...(sustain ? [0, 0xb0, 64, 127] : []), 0, 0x90, 60, 100, 0x83, 0x60, 0xb0, mode, 0,
		...(sustain ? [0x87, 0x40, 0xb0, 64, 0, 0x83, 0x60] : [0x8b, 0x20]), 0x80, 60, 0, 0, 0xff, 0x2f, 0];
	return new File([Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 1, 0xe0,
		0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, track.length, ...track])], `mode-${String(mode)}.mid`);
}

function peak(samples: Float32Array, start: number, end: number): number {
	return samples.subarray(start, end).reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
}

// MIDI channel modes 124–127 also perform All Notes Off. The file reader
// already honors this; editing the authored note must preserve its PCM meaning.
// https://midi.org/summary-of-midi-1-0-messages
for (const mode of [123, 124, 125, 126, 127]) for (const sustain of [false, true]) {
	test(`note edits retain mode ${String(mode)} key release with sustain=${String(sustain)}`, async context => {
		const { controller, pcm } = await midiControllerPcmFixture();
		context.after(async () => { await controller.dispose(); });
		await controller.actions.project.importFiles([channelModeFile(mode, sustain)]);
		const clip = controller.project!.clips[0]!;
		const note = readMidiClip(clip)!.notes[0]!;
		assert.equal(note.durationFrames, 24_000, 'the admitted file already releases its key at half a second');
		await controller.actions.midi.updateNote(clip.id, note.id, { durationFrames: 96_000 });
		const updated = controller.project!.clips.find(value => value.id === clip.id)!;
		assert.equal(readMidiClip(updated)!.notes[0]!.durationFrames, 96_000, 'the authored edit remains intact');
		const samples = Float32Array.from(pcm.get(updated.sourceId)!.flatMap(chunk => Array.from(chunk)));
		assert.ok(peak(samples, 4800, 9600) > 0.02, 'the original key onset remains audible');
		if (sustain) assert.ok(peak(samples, 30_000, 40_000) > 0.02, 'pedal-held sound survives key release');
		assert.equal(peak(samples, sustain ? 78_000 : 30_000, sustain ? 88_000 : 40_000), 0,
			'the retained channel-mode release still bounds the sounding voice');
	});
}

for (const mode of [124, 125, 126, 127]) for (const namespace of ['channel', 'port'] as const) {
	test(`mode ${String(mode)} cannot release another MIDI ${namespace}`, () => {
		const note: MidiNote = { id: 'note', pitch: 60, velocity: 100, startFrame: 0, durationFrames: 48_000,
			channel: namespace === 'channel' ? 1 : 0, ...(namespace === 'port' ? { midiPort: 1 } : {}) };
		const events = [...(namespace === 'port' ? [{ frame: 0, status: 255, metaType: 0x21, data: [2] }] : []),
			{ frame: 24_000, status: 176, data: [mode, 0] }];
		assert.deepEqual(renderMidiFrames([note], 'triangle', 48_000, 0, 48_000, events),
			renderMidiFrames([note], 'triangle', 48_000, 0, 48_000));
	});
}
