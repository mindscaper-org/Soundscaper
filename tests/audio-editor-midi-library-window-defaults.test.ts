/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';

for (const instrument of ['fluidsynth', 'libadlmidi'] as const) test(`looped ${instrument} MIDI retains the library's initial volume`, async () => {
	const f = midiServiceFixture();
	const imported = (await f.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Loop',
		notes: [{ id: 'key', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000 }], durationFrames: 16000,
		events: [{ frame: 0, status: 192, data: [40] }, { frame: 6000, status: 176, data: [7, 30] }] }] }))[0]!;
	assert.ok(imported.trackId);
	await f.service.setInstrument(imported.trackId, instrument);
	const clip = f.project().clips.find(value => value.id === imported.clipId)!;
	const native = Float32Array.from(f.pcm.get(clip.sourceId)!.flatMap(chunk => [...chunk]));
	f.apply({ type: 'clip/update', clipId: clip.id, changes: { loop: { periodFrames: 16000, durationFrames: 32000 } } });
	await f.service.exportFile('midi'); assert.ok(f.saves[0]?.bytes instanceof Uint8Array);
	const delivered = parseMidiFile(f.saves[0].bytes, { sampleRate: 8000 }).tracks.find(track => track.notes.length)!;
	assert.equal(delivered.notes.length, 2, 'the actual public loop edit must export both repetitions');
	const firstWindow = await openMidiAudioRenderer({ version: 1, notes: delivered.notes.filter(note => note.startFrame < 16000),
		interchange: { tempos: [], signatures: [], events: (delivered.events ?? []).filter(event => event.frame < 16000) } }, instrument, 8000);
	try {
		const exported = (await firstWindow.render(0, 16000))[0]!;
		const error = exported.subarray(512, 4000).reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - native[index + 512]!)), 0);
		assert.ok(native.some(value => Math.abs(value) > .001));
		assert.ok(error < .000001, `the exported loop must retain its native initial volume; error ${error}`);
	} finally { await firstWindow.close(); }
});
