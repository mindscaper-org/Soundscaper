/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';

const note = { id: 'key', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000 };
const cc = (frame: number, controller: number, value: number): MidiFileEvent => ({ frame, status: 176, data: [controller, value] });

for (const instrument of ['fluidsynth', 'libadlmidi'] as const) for (const scenario of [
	{ name: 'volume', first: [cc(0, 7, 30)], second: [] },
	{ name: 'modulation', first: [cc(0, 1, 127)], second: [] },
	{ name: 'pan', first: [cc(0, 10, 0)], second: [] },
	{ name: 'authored volume', first: [cc(0, 7, 30)], second: [cc(0, 7, 48)] },
	{ name: 'authored pan', first: [cc(0, 10, 127)], second: [cc(0, 10, 0)] },
	{ name: 'reset modulation', first: [cc(0, 1, 127), cc(10000, 121, 0)], second: [] },
	{ name: 'sostenuto edge', first: [cc(10000, 66, 127)], second: [cc(1000, 66, 127), cc(8000, 66, 0)] },
].filter(scenario => instrument === 'fluidsynth' || scenario.name === 'volume')) test(`independent ${instrument} clips retain ${scenario.name} defaults after sharing a lane`, async () => {
	const f = midiServiceFixture();
	const importTrack = async (name: string, events: readonly MidiFileEvent[]) => (await f.service.importDocument({ sampleRate: 8000,
		tempos: [], signatures: [], tracks: [{ name, notes: [note], durationFrames: 16000,
			events: [{ frame: 0, status: 192, data: [40] }, ...events] }] }))[0]!;
	const first = await importTrack('First', scenario.first), second = await importTrack('Second', scenario.second);
	assert.ok(first.trackId && second.trackId);
	await f.service.setInstrument(first.trackId, instrument);
	await f.service.setInstrument(second.trackId, instrument);
	const sourceId = f.project().clips.find(clip => clip.id === second.clipId)!.sourceId;
	const native = Float32Array.from(f.pcm.get(sourceId)!.flatMap(chunk => [...chunk]));
	f.apply({ type: 'clip/move', clipId: second.clipId, trackId: first.trackId, timelineStartFrame: 32000 });
	await f.service.exportFile('midi'); assert.ok(f.saves[0]?.bytes instanceof Uint8Array);
	const delivered = parseMidiFile(f.saves[0].bytes, { sampleRate: 8000 }).tracks.find(track => track.notes.length)!;
	const renderer = await openMidiAudioRenderer({ version: 1, notes: delivered.notes,
		interchange: { tempos: [], signatures: [], events: delivered.events ?? [] } }, instrument, 8000);
	try {
		const exported = (await renderer.render(0, 48000))[0]!.subarray(32000);
		const error = exported.subarray(512, 12000).reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - native[index + 512]!)), 0);
		assert.ok(native.some(value => Math.abs(value) > .001));
		if (instrument === 'fluidsynth') assert.ok(error < .000001, `${scenario.name} must retain the independent source PCM; error ${error}`);
		else {
			// The FM chip free-runs across the gap, so compare sustained energy instead of phase.
			const energy = (plane: Float32Array) => plane.subarray(512, 3500).reduce((sum, value) => sum + value * value, 0);
			const gain = Math.sqrt(energy(exported) / energy(native));
			assert.ok(gain > .95 && gain < 1.05, `FM delivery must retain its independent source level; gain ${gain}`);
		}
	} finally { await renderer.close(); }
});
