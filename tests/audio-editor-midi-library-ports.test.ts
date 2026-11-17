/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer, registerMidiInstrumentProvider } from '../src/common/editor/engine/midi-audio-renderer.ts';
import { compileMidiAudioTimeline } from '../src/common/editor/engine/midi-audio-events.ts';
import type { MidiClipData } from '../src/common/editor/midi-model.ts';

for (const instrument of ['fluidsynth', 'libadlmidi'] as const) test(`imported MIDI port controls remain isolated with ${instrument}`, async () => {
	const note = { id: 'key', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000, midiPort: 1 };
	const bytes = writeMidiFile({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Two destinations', notes: [note],
		events: [{ frame: 0, status: 0xb0, data: [7, 0] }] }] });
	const track = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.find(track => track.notes.length)!;
	const data: MidiClipData = { version: 1, notes: track.notes, interchange: { events: track.events ?? [], tempos: [], signatures: [] } };
	for (const origin of [0, 1000]) {
		const actual = await openMidiAudioRenderer(data, instrument, 8000, origin);
		const expected = await openMidiAudioRenderer({ version: 1, notes: [{ ...note, midiPort: undefined }] }, instrument, 8000, origin);
		try {
			const reference = await expected.render(origin, 2000);
			assert.ok(reference.some(plane => plane.some(value => Math.abs(value) > .001)));
			assert.deepEqual(await actual.render(origin, 2000), reference, 'a muted destination must not silence a note on another MIDI port');
		} finally { await actual.close(); await expected.close(); }
	}
});

test('simultaneous MIDI destinations retain independent instruments and channel volume', async () => {
	const note = { id: 'a', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000, midiPort: 0 };
	const actual = await openMidiAudioRenderer({ version: 1, notes: [note, { ...note, id: 'b', midiPort: 1 }],
		interchange: { tempos: [], signatures: [], events: [
			{ frame: 0, status: 255, metaType: 0x21, data: [1] }, { frame: 0, status: 0xb0, data: [7, 0] },
		] } }, 'fluidsynth', 8000);
	const expected = await openMidiAudioRenderer({ version: 1, notes: [note] }, 'fluidsynth', 8000);
	try {
		const result = await actual.render(0, 2000), reference = await expected.render(0, 2000);
		assert.ok(reference[0]!.some(value => Math.abs(value) > .01));
		// FluidSynth's muted voice retains a tiny gain floor.
		assert.ok(result.every((plane, channel) => plane.every((value, frame) => Math.abs(value - reference[channel]![frame]!) < .00001)));
	}
	finally { await actual.close(); await expected.close(); }
});

for (const prepared of [false, true]) test(`native instrument port state is isolated with worker preparation ${prepared}`, async () => {
	const instrument = { kind: 'native' as const, format: 'vst3' as const, stablePluginId: 'synth', binarySha256: 'a'.repeat(64), name: 'Synth', state: '' };
	const data: MidiClipData = { version: 1, notes: [0, 1].map(midiPort => ({ id: String(midiPort), midiPort, pitch: 69, channel: 0,
		velocity: 100, startFrame: 0, durationFrames: 4000 })), interchange: { tempos: [], signatures: [], events: [
			{ frame: 0, status: 255, metaType: 0x21, data: [1] }, { frame: 0, status: 0xb0, data: [7, 0] },
		] } };
	let opened = 0, closed = 0;
	const unregister = registerMidiInstrumentProvider(async () => {
		opened++; let volume = 1, sounding = false;
		return { channelCount: 1, latencyFrames: 0, async process(frames, events) {
			for (const event of events) {
				if (event.data[0] === 0xb0 && event.data[1] === 7) volume = event.data[2]! / 127;
				if (event.data[0] === 0x90) sounding = true;
			}
			return [new Float32Array(frames).fill(sounding ? volume : 0)];
		}, async close() { closed++; } };
	});
	try {
		const renderer = await openMidiAudioRenderer(data, instrument, 8000, 1000, prepared ? compileMidiAudioTimeline(data, 1000) : undefined);
		try { assert.deepEqual([...(await renderer.render(1000, 8))[0]!], Array(8).fill(1)); assert.equal(opened, 2); }
		finally { await renderer.close(); }
		assert.equal(closed, 2);
	} finally { unregister(); }
});
