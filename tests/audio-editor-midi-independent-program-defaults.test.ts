/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import type { MidiFileEvent } from '../src/common/editor/midi-file-types.ts';
import { quietMidiClipPerformanceEvents, type MidiPerformanceOccurrence } from '../src/common/editor/midi-project-performance-state.ts';

const note = { id: 'key', pitch: 67, channel: 0, velocity: 100, startFrame: 0, durationFrames: 4000 };

for (const ownProgram of [undefined, 80]) test(`independent imported MIDI clips retain their own program ${String(ownProgram ?? 0)} after sharing a lane`, async () => {
	const f = midiServiceFixture();
	const first = (await f.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{
		name: 'First', notes: [note], events: [{ frame: 0, status: 192, data: [40] }], durationFrames: 16000,
	}] }))[0]!;
	const second = (await f.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{
		name: 'Second', notes: [note], events: ownProgram === undefined ? [] : [{ frame: 0, status: 192, data: [ownProgram] }], durationFrames: 16000,
	}] }))[0]!;
	assert.ok(first.trackId && second.trackId);
	await f.service.setInstrument(first.trackId, 'fluidsynth');
	await f.service.setInstrument(second.trackId, 'fluidsynth');
	const secondClip = f.project().clips.find(clip => clip.id === second.clipId)!;
	const native = f.pcm.get(secondClip.sourceId)![0]!.slice(0, 4000);
	f.apply({ type: 'clip/move', clipId: second.clipId, trackId: first.trackId, timelineStartFrame: 32000 });
	await f.service.exportFile('midi');
	assert.ok(f.saves[0]?.bytes instanceof Uint8Array);
	const delivered = parseMidiFile(f.saves[0].bytes, { sampleRate: 8000 }).tracks.find(track => track.notes.length)!;
	const render = await openMidiAudioRenderer({ version: 1, notes: delivered.notes,
		interchange: { tempos: [], signatures: [], events: delivered.events ?? [] },
	}, 'fluidsynth', 8000);
	try {
		const exported = (await render.render(0, 36000))[0]!.subarray(32000);
		// Separate synth instances have their own attack startup; compare the settled tone.
		const error = exported.subarray(512).reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - native[frame + 512]!)), 0);
		assert.ok(native.some(sample => Math.abs(sample) > .001));
		assert.ok(error < .000001, `MIDI export must retain the native second clip patch, PCM error ${String(error)}`);
		assert.equal(patchAt(delivered.events ?? [], 32000).program, ownProgram ?? 0);
	} finally { await render.close(); }
});

for (const scenario of [
	{ name: 'default patch with an authored pending bank', own: [{ frame: 0, status: 176, data: [0, 4] }], expected: { program: 0, bank: [0, 0], pending: [4, 0] } },
	{ name: 'own program with default banks', own: [{ frame: 0, status: 192, data: [80] }], expected: { program: 80, bank: [0, 0], pending: [0, 0] } },
	{ name: 'own complete bank and program setup', own: [{ frame: 0, status: 176, data: [0, 4] }, { frame: 0, status: 176, data: [32, 6] }, { frame: 0, status: 192, data: [80] }], expected: { program: 80, bank: [4, 6], pending: [4, 6] } },
]) test(`independent source preserves ${scenario.name}`, async () => {
	const events = await mergedEvents([
		{ frame: 0, status: 176, data: [0, 2] }, { frame: 0, status: 176, data: [32, 3] },
		{ frame: 0, status: 192, data: [40] }, { frame: 1000, status: 176, data: [0, 7] },
	], scenario.own);
	assert.deepEqual(patchAt(events, 32000), scenario.expected);
});

test('materializing a default reset retains a track metadata program at the first onset', async () => {
	const events = await mergedEvents([], [], 40);
	assert.equal(patchAt(events, 0).program, 40);
	assert.equal(patchAt(events, 32000).program, 0);
});

for (const foreign of [false, true]) test(`program defaults never rewrite ${foreign ? 'another output track' : 'an overlapping source'}`, () => {
	const start = foreign ? 32000 : 8000;
	const occurrences: MidiPerformanceOccurrence[] = [
		{ track: 0, start: 0, end: 16000, notes: [note], events: [{ frame: 0, status: 192, data: [40] }], eligible: true },
		{ track: foreign ? 1 : 0, start, end: start + 16000, notes: [{ ...note, pitch: 72, startFrame: start }], events: [], eligible: true },
	];
	const tracks = Array.from({ length: foreign ? 2 : 1 }, (_, index) => ({ name: String(index),
		notes: occurrences.filter(value => value.track === index).flatMap(value => value.notes),
		events: occurrences.filter(value => value.track === index).flatMap(value => value.events),
	}));
	assert.equal(quietMidiClipPerformanceEvents({ sampleRate: 8000, tracks, tempos: [], signatures: [] }, occurrences,
		() => assert.fail('shared channel state must not receive unilateral resets')).size, 0);
});

async function mergedEvents(firstEvents: readonly MidiFileEvent[], secondEvents: readonly MidiFileEvent[], firstProgram?: number) {
	const f = midiServiceFixture();
	const first = (await f.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{
		name: 'First', notes: [note], events: firstEvents, program: firstProgram, durationFrames: 16000,
	}] }))[0]!;
	const second = (await f.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{
		name: 'Second', notes: [note], events: secondEvents, durationFrames: 16000,
	}] }))[0]!;
	assert.ok(first.trackId);
	f.apply({ type: 'clip/move', clipId: second.clipId, trackId: first.trackId, timelineStartFrame: 32000 });
	await f.service.exportFile('midi'); assert.ok(f.saves[0]?.bytes instanceof Uint8Array);
	return parseMidiFile(f.saves[0].bytes, { sampleRate: 8000 }).tracks.find(track => track.notes.length)!.events ?? [];
}

function patchAt(events: readonly MidiFileEvent[], frame: number) {
	let msb = 0, lsb = 0, program = 0, bank = [0, 0];
	for (const event of events) if (event.frame <= frame) {
		if (event.status === 176 && event.data[0] === 0) msb = event.data[1]!;
		if (event.status === 176 && event.data[0] === 32) lsb = event.data[1]!;
		if (event.status === 192) { program = event.data[0]!; bank = [msb, lsb]; }
	}
	return { program, bank, pending: [msb, lsb] };
}
