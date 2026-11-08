/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiControllerPcmFixture } from './helpers/midi-controller-pcm-fixture.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { normalizeMidiClipData, readMidiClip, updateMidiNoteData } from '../src/common/editor/midi-model.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function file(messages: readonly number[]): File {
	const body = [...messages, 0x8f, 0, 0x80, 60, 0, 0, 255, 47, 0];
	return new File([Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, body.length >> 8, body.length & 255, ...body])], 'Immediate release.mid');
}
const on = [0, 0x90, 60, 100];
const control = (number: number, value = 0): number[] => [0, 0xb0, number, value];
const peak = (samples: Float32Array): number => samples.subarray(100, 1000).reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);

for (const mode of [123, 124, 125, 126, 127]) for (const after of [false, true]) {
	test(`public duration edit preserves mode ${String(mode)} ${after ? 'after' : 'before'} its same-tick onset`, async context => {
		const { controller, pcm } = await midiControllerPcmFixture();
		context.after(async () => { await controller.dispose(); });
		await controller.actions.project.importFiles([file(after ? [...on, ...control(mode)] : [...control(mode), ...on])]);
		const clip = controller.project!.clips[0]!, note = readMidiClip(clip)!.notes[0]!;
		assert.equal(note.durationFrames, after ? 1 : 96_000);
		await controller.actions.midi.updateNote(clip.id, note.id, { durationFrames: 96_000 });
		const updated = controller.project!.clips[0]!;
		const samples = Float32Array.from(pcm.get(updated.sourceId)!.flatMap(chunk => Array.from(chunk)));
		if (after) assert.equal(peak(samples), 0);
		else assert.ok(peak(samples) > 0.02);
	});
}

for (const sustain of ['held', 'too-late', 'released-again'] as const) {
	test(`same-tick key release uses its causal sustain state (${sustain}) through native data and MIDI delivery`, async () => {
		const messages = sustain === 'held' ? [...control(123), ...control(64, 127), ...on, ...control(124)]
			: sustain === 'too-late' ? [...on, ...control(123), ...control(64, 127)]
				: [...control(64, 127), ...on, ...control(123), ...control(64), ...control(64, 127)];
		const document = parseMidiFile(await file(messages).arrayBuffer(), { sampleRate: 8000 });
		const track = document.tracks[0]!;
		const data = normalizeMidiClipData({ version: 1, notes: track.notes, interchange: { events: track.events, tempos: [], signatures: [] } });
		const note = data.notes[0]!;
		const edited = updateMidiNoteData(data, note.id, { durationFrames: 16_000 });
		const restored = normalizeMidiClipData(JSON.parse(JSON.stringify(edited)));
		const samples = renderMidiFrames(restored.notes, 'square', 8000, 0, 8000, restored.interchange!.events);
		if (sustain === 'held') assert.ok(peak(samples) > 0.02);
		else assert.equal(peak(samples), 0);
		const reopened = parseMidiFile(writeMidiFile({ ...document, tracks: [{ ...track, notes: restored.notes, events: restored.interchange!.events }] }), { sampleRate: 8000 });
		const delivered = reopened.tracks.find(value => value.notes.length)!;
		const pcm = renderMidiFrames(delivered.notes, 'square', 8000, 0, 8000, delivered.events);
		if (sustain === 'held') assert.ok(peak(pcm) > 0.02);
		else assert.equal(peak(pcm), 0);
	});
}

test('a same-controller mode before and after the onset binds to the later causal message', async () => {
	const document = parseMidiFile(await file([...control(123), ...control(64, 127), ...on, ...control(123)]).arrayBuffer(), { sampleRate: 8000 });
	const note = document.tracks[0]!.notes[0]!;
	assert.ok(note.onsetStop);
	const reopened = parseMidiFile(writeMidiFile(document), { sampleRate: 8000 });
	const track = reopened.tracks.find(value => value.notes.length)!;
	assert.ok(peak(renderMidiFrames(track.notes, 'square', 8000, 0, 8000, track.events)) > 0.02);
});

test('a left-trimmed immediate key release preserves its later pedal-held voice', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(await file([...control(64, 127), ...on, ...control(123),
		0x83, 0x60, 0xb0, 64, 0]).arrayBuffer(), { sampleRate: 8000 }));
	const clip = f.project().clips[0]!;
	await f.service.resizeClip(clip.id, { timelineStartFrame: 0, sourceStartFrame: 2000, durationFrames: 14_000 });
	await f.service.exportFile('midi');
	const bytes = f.saves[0]!.bytes; assert.ok(bytes instanceof Uint8Array);
	const track = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.find(value => value.notes.length)!;
	const samples = renderMidiFrames(track.notes, 'square', 8000, 0, 8000, track.events);
	assert.ok(peak(samples) > 0.02);
	assert.ok(samples.subarray(3000).every(value => value === 0));
});

test('loop occurrences namespace causal release IDs without changing their silence', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(await file([...on, ...control(123)]).arrayBuffer(), { sampleRate: 8000 }));
	const clip = f.project().clips[0]!;
	f.apply({ type: 'clip/update', clipId: clip.id, changes: { loop: { periodFrames: 16_000, durationFrames: 32_000, offsetFrames: 0 } } });
	await f.service.exportFile('midi');
	const bytes = f.saves[0]!.bytes; assert.ok(bytes instanceof Uint8Array);
	const track = parseMidiFile(bytes, { sampleRate: 8000 }).tracks.find(value => value.notes.length)!;
	assert.equal(track.notes.length, 2);
	assert.ok(renderMidiFrames(track.notes, 'square', 8000, 0, 32_000, track.events).every(value => value === 0));
});

test('a mode on a separate controller-only track remains attached to its unique note owner', async () => {
	const f = midiServiceFixture();
	const noteTrack = [0, 0x90, 60, 100, 0x87, 0x40, 255, 47, 0];
	const controlTrack = [0, 0xb0, 124, 0, 0x87, 0x40, 255, 47, 0];
	const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, 2, 1, 224,
		77, 84, 114, 107, 0, 0, 0, noteTrack.length, ...noteTrack,
		77, 84, 114, 107, 0, 0, 0, controlTrack.length, ...controlTrack]);
	await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	const clip = f.project().clips.find(value => readMidiClip(value)?.notes.length)!;
	await f.service.updateNote(clip.id, readMidiClip(clip)!.notes[0]!.id, { durationFrames: 8000 });
	assert.ok(f.pcm.get(f.project().clips.find(value => value.id === clip.id)!.sourceId)![0]!.every(value => value === 0));
	await f.service.exportFile('midi');
	assert.ok(f.saves[0]!.bytes instanceof Uint8Array);
});

for (const held of [false, true]) test(`shared-channel causal release keeps file import and regenerated PCM (sustain ${String(held)})`, async context => {
	const { controller, pcm } = await midiControllerPcmFixture();
	context.after(async () => { await controller.dispose(); });
	const first = [...(held ? control(64, 127) : []), ...on, 0x87, 0x40, 255, 47, 0];
	const second = [...control(123), 0, 0x90, 64, 100, 0x83, 0x60, 0x80, 64, 0, 0, 255, 47, 0];
	const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, 2, 1, 224,
		77, 84, 114, 107, 0, 0, 0, first.length, ...first,
		77, 84, 114, 107, 0, 0, 0, second.length, ...second]);
	await controller.actions.project.importFiles([new File([bytes], 'Shared release.mid')]);
	assert.equal(controller.project!.clips.length, 2);
	const clip = controller.project!.clips[0]!, note = readMidiClip(clip)!.notes[0]!;
	await controller.actions.midi.updateNote(clip.id, note.id, { durationFrames: 96_000 });
	const updated = controller.project!.clips.find(value => value.id === clip.id)!;
	const samples = Float32Array.from(pcm.get(updated.sourceId)!.flatMap(chunk => Array.from(chunk)));
	if (held) assert.ok(peak(samples) > 0.02);
	else assert.equal(peak(samples), 0);
});

for (const release of [64, 121, 120]) test(`immediate key release follows later damper termination ${String(release)} across synchronous tracks`, async () => {
	const first = [...control(64, 127), ...on, 0x87, 0x40, 255, 47, 0];
	const second = [...control(123), 0x83, 0x60, 0xb0, release, 0, 0x83, 0x60, 255, 47, 0];
	const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, 2, 1, 224,
		77, 84, 114, 107, 0, 0, 0, first.length, ...first,
		77, 84, 114, 107, 0, 0, 0, second.length, ...second]);
	const document = parseMidiFile(bytes, { sampleRate: 8000 });
	const track = document.tracks[0]!;
	const data = normalizeMidiClipData({ version: 1, notes: track.notes, interchange: { events: track.events, tempos: [], signatures: [] } });
	const edited = updateMidiNoteData(data, data.notes[0]!.id, { durationFrames: 16_000 });
	const samples = renderMidiFrames(edited.notes, 'square', 8000, 0, 8000, edited.interchange!.events);
	assert.ok(peak(samples) > 0.02);
	assert.ok(samples.subarray(4000).every(value => value === 0));
});
