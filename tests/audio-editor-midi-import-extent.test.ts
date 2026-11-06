/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

for (const destination of ['timeline', 'project-bin'] as const) {
	for (const durationFrames of [4000, 24000]) test(`${destination} MIDI import keeps its ${durationFrames}-frame authored ending`, async () => {
		const fixture = midiServiceFixture();
		const document = parseMidiFile(writeMidiFile({ sampleRate: 8000, tempos: [{ frame: 0, bpm: 120 }], signatures: [],
			tracks: [{ name: 'One phrase', durationFrames, notes: [{ id: 'n', pitch: 60, velocity: 100, channel: 0,
				startFrame: 0, durationFrames: 2000 }] }] }), { sampleRate: 8000 });
		assert.equal(document.tracks.find(track => track.notes.length)!.durationFrames, durationFrames);
		await fixture.service.importDocument(document, { destination });
		const project = fixture.project();
		const clip = destination === 'timeline' ? project.clips[0]! : project.projectBin.clips[0]!;
		assert.equal(clip.durationFrames, durationFrames, 'import must not append an unrequested bar of silence');
		assert.equal(project.sources.find(source => source.id === clip.sourceId)!.frameCount, durationFrames);
		if (destination === 'timeline') {
			await fixture.service.exportFile('midi');
			const delivered = parseMidiFile(fixture.saves[0]!.bytes as Uint8Array, { sampleRate: 8000 });
			assert.equal(delivered.tracks.find(track => track.notes.length)!.durationFrames, durationFrames);
		}
	});
}

test('New MIDI track retains its existing four-bar authoring area', async () => {
	const fixture = midiServiceFixture();
	await fixture.service.addTrack();
	assert.equal(fixture.project().clips[0]!.durationFrames, 64000);
});

test('An omitted empty conductor retains the song ending beyond its short note lane', async () => {
	const fixture = midiServiceFixture();
	await fixture.service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [
		{ name: 'Conductor', conductorOnly: true, durationFrames: 32000, notes: [], events: [] },
		{ name: 'Phrase', durationFrames: 4000, notes: [{ id: 'n', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 2000 }] },
	] });
	assert.equal(fixture.project().clips.length, 1);
	assert.equal(fixture.project().clips[0]!.durationFrames, 32000);
});
