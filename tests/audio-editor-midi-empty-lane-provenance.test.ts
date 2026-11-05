/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';

test('all 256 authored empty lanes survive conductor co-location at the supported track limit', async () => {
	const first = midiServiceFixture();
	for (let index = 0; index < 256; index += 1) {
		const created = await first.service.addTrack();
		first.apply({ type: 'track/update', trackId: created.trackId, changes: { name: `Lane ${index}` } });
	}
	assert.ok(validateAudioEditorProjectV17(first.project()));
	await first.service.exportFile('midi');
	const bytes = first.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const document = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.equal(document.tracks.length, 256);
	assert.equal(document.tracks[0]?.name, 'Lane 0');
	const second = midiServiceFixture(); await second.service.importDocument(document);
	assert.equal(second.project().tracks.length, 256);
	assert.deepEqual(second.project().tracks.map(track => track.name), first.project().tracks.map(track => track.name));
});

test('explicit track-name provenance preserves an authored timing-only lane and an unnamed conductor tail', async () => {
	const track = (events: readonly number[]): readonly number[] => [0x4d, 0x54, 0x72, 0x6b,
		(events.length >>> 24) & 255, (events.length >>> 16) & 255, (events.length >>> 8) & 255, events.length & 255, ...events];
	const bytes = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0,
		...track([0, 255, 0x51, 3, 7, 0xa1, 0x20, 0x9e, 0, 255, 0x2f, 0]),
		...track([0, 255, 3, 6, ...new TextEncoder().encode('Timing'), 0, 255, 0x51, 3, 7, 0xa1, 0x20, 0, 255, 0x2f, 0])]);
	const document = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.conductorOnly, true);
	assert.equal(document.tracks[1]?.conductorOnly, undefined);
	const f = midiServiceFixture(); await f.service.importDocument(document);
	assert.deepEqual(f.project().tracks.map(track => track.name), ['Timing']);
	assert.equal(f.project().clips[0]?.durationFrames, 32000);
});
