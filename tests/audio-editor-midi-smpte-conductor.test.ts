/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { normalizeMidiClipData, readMidiClip } from '../src/common/editor/midi-model.ts';
import { createAudioEditorProjectV17, validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { asBaselineSoundscaperProject, importBaselineScapeProject } from './helpers/baseline-scape-runtime.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';

const offset = (hour: number) => [0, 255, 0x54, 5, hour, 0, 0, 0, 0];
const note = [0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0];
function file(format: 0 | 1, tracks: readonly (readonly number[])[]): Uint8Array<ArrayBuffer> {
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, format, tracks.length >> 8, tracks.length & 255, 1, 224,
		...tracks.flatMap(events => {
			const track = [...events, 0, 255, 47, 0];
			return [77, 84, 114, 107, 0, 0, track.length >> 8, track.length & 255, ...track];
		})]);
}

for (const format of [0, 1] as const) test(`MIDI type${format} keeps its active SMPTE offset on the exported conductor`, async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(file(format, format ? [offset(1), note] : [[...offset(1), ...note]]), { sampleRate: 8000 }));
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	const output = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.deepEqual(output.tracks[0]?.events?.filter(event => event.metaType === 0x54), [
		{ frame: 0, status: 255, metaType: 0x54, data: [1, 0, 0, 0, 0], conductor: true },
	]);
	assert.equal(output.tracks.slice(1).flatMap(track => track.events ?? []).filter(event => event.metaType === 0x54).length, 0);
});

test('a type1 nonconductor SMPTE offset remains semantically ignored after export', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(file(1, [[], [...offset(2), ...note]]), { sampleRate: 8000 }));
	assert.equal(readMidiClip(f.project().clips[0])?.interchange?.events.find(event => event.metaType === 0x54)?.conductor, false);
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	const output = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.equal(output.tracks[0]?.events?.some(event => event.metaType === 0x54) ?? false, false);
	assert.equal(output.tracks.slice(1).flatMap(track => track.events ?? []).find(event => event.metaType === 0x54)?.conductor, false);
});

test('Scape and source-window projection retain active and ignored SMPTE provenance', async context => {
	const f = midiServiceFixture();
	const created = await f.service.importDocument(parseMidiFile(file(1, [offset(1), [...offset(2), ...note]]), { sampleRate: 8000 }));
	for (const clip of created) await f.service.resizeClip(clip.clipId, { timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 8000 });
	const sender = createMemoryProjectStore(context, 'midi-smpte-sender');
	const receiver = createMemoryProjectStore(context, 'midi-smpte-receiver');
	for (const source of f.project().sources) {
		const writer = await sender.beginSourceWrite(source.storageKey, source);
		const chunks = f.pcm.get(source.id);
		assert.ok(chunks);
		for (const chunk of chunks) await writer.write([chunk]);
		await writer.commit(source);
	}
	const archive = await exportScapeProject(asBaselineSoundscaperProject(f.project()), sender);
	const reopened = await importBaselineScapeProject(archive.blob, receiver);
	const admitted = createAudioEditorProjectV17(reopened.project);
	assert.equal(validateAudioEditorProjectV17(admitted), true);
	const projected = midiDocumentFromProject({ ...admitted });
	assert.deepEqual(projected.tracks.flatMap(track => track.events ?? []).filter(event => event.metaType === 0x54).map(event => event.conductor), [true, false]);
});

test('MIDI export refuses ambiguous legacy, conflicting and displaced active SMPTE offsets before save', async () => {
	const imported = parseMidiFile(file(0, [[...offset(1), ...note]]), { sampleRate: 8000 });
	const conflict = midiServiceFixture();
	await conflict.service.importDocument(imported);
	await conflict.service.importDocument(parseMidiFile(file(0, [[...offset(2), ...note]]), { sampleRate: 8000 }));
	await assert.rejects(conflict.service.exportFile('midi'), /SMPTE.*conflict|conflict.*SMPTE/iu);
	assert.equal(conflict.saves.length, 0);
	const moved = midiServiceFixture();
	await moved.service.importDocument(imported, { timelineStartFrame: 8000 });
	await assert.rejects(moved.service.exportFile('midi'), /SMPTE/iu);
	assert.equal(moved.saves.length, 0);
	const legacy = midiServiceFixture();
	await legacy.service.importDocument({ ...imported, tracks: imported.tracks.map(track => ({ ...track,
		events: track.events?.map(({ conductor: _conductor, ...event }) => event) })) });
	await assert.rejects(legacy.service.exportFile('midi'), /SMPTE.*provenance|provenance.*SMPTE/iu);
	assert.equal(legacy.saves.length, 0);
});

test('native MIDI event admission restricts conductor provenance to boolean SMPTE roles', () => {
	for (const event of [{ frame: 0, status: 255, metaType: 0x54, data: [1, 0, 0, 0, 0], conductor: 'true' },
		{ frame: 0, status: 0xb0, data: [7, 127], conductor: true }]) {
		assert.throws(() => normalizeMidiClipData({ version: 1, notes: [], interchange: { events: [event], tempos: [], signatures: [] } }), /conductor/iu);
	}
});

test('matching active SMPTE offsets deduplicate and a left trim refuses unsupported clock relocation', async () => {
	const document = parseMidiFile(file(0, [[...offset(1), ...note]]), { sampleRate: 8000 });
	const f = midiServiceFixture();
	const created = await f.service.importDocument(document);
	await f.service.importDocument(document);
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.equal(parseMidiFile(bytes).tracks.flatMap(track => track.events ?? []).filter(event => event.metaType === 0x54).length, 1);
	await f.service.resizeClip(created[0]!.clipId, { timelineStartFrame: 0, sourceStartFrame: 1000, durationFrames: 8000 });
	await assert.rejects(f.service.exportFile('midi'), /SMPTE/iu);
	assert.equal(f.saves.length, 1);
});

test('at the native 256-track limit an ignored SMPTE offset cannot become active on the folded conductor', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(file(1, [[], [...offset(2), ...note],
		...Array.from({ length: 254 }, () => note)]), { sampleRate: 8000 }));
	await f.service.addTrack();
	assert.equal(f.project().tracks.length, 256);
	await assert.rejects(f.service.exportFile('midi'), /ignored SMPTE Offset/iu);
	assert.equal(f.saves.length, 0);
});
