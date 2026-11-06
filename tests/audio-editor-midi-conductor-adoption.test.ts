/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function source(bpm: number, numerator = 3, exponent = 2): Uint8Array<ArrayBuffer> {
	const micros = 60_000_000 / bpm;
	assert.ok(Number.isInteger(micros) && micros <= 0xffffff);
	const delta = bpm * 4; // Exactly half a second at 480 PPQ.
	const events = [0, 255, 81, 3, micros >>> 16, micros >>> 8 & 255, micros & 255,
		0, 255, 88, 4, numerator, exponent, 24, 8, 0, 144, 60, 100,
		...(delta >= 128 ? [delta >>> 7 | 128, delta & 127] : [delta]), 128, 60, 0, 0, 255, 47, 0];
	return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
		77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
}

for (const bpm of [4, 1000, 1200]) test(`File Import retains MIDI timing while optionally adopting ${bpm} BPM`, async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	const parsed = parseMidiFile(source(bpm), { sampleRate: 48_000 });
	const importer = createMidiImportFiles({ getProject: fixture.project,
		importFiles: () => assert.fail('MIDI must use its importer') }, async () => fixture.service);
	await importer.importFiles([new File([source(bpm)], 'Tempo.mid')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	assert.equal(fixture.project().tempo.bpm, bpm <= 1000 ? bpm : 120);
	assert.deepEqual(fixture.project().tempo.timeSignature, { numerator: 3, denominator: 4 });
	const clip = fixture.project().clips[0]; assert.ok(clip);
	const data = readMidiClip(clip); assert.ok(data);
	assert.deepEqual(data.notes, parsed.tracks[0]?.notes);
	assert.deepEqual(data.interchange?.tempos, parsed.tempos);
	assert.deepEqual(data.interchange?.signatures, parsed.signatures);
	assert.equal(clip.durationFrames, 24_000);
	assert.equal(fixture.project().sources.find(item => item.id === clip.sourceId)?.frameCount, 24_000);
	assert.ok(fixture.pcm.get(clip.sourceId)?.some(chunk => chunk.some(value => value !== 0)));
	const restored: unknown = JSON.parse(JSON.stringify(fixture.project()));
	assert.ok(validateAudioEditorProjectV17(restored));
	assert.deepEqual(readMidiClip(restored.clips[0]), data);
});

for (const bpm of [.5, 1]) test(`Allegro File Import preserves source tempo ${bpm} without widening the project range`, async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	const text = `#track 0\nT0 -tempor:${bpm}\nT0 V0 K60 P60 U0.5 L100\n`;
	const parsed = parseAllegroFile(text, { sampleRate: 48_000 });
	const importer = createMidiImportFiles({ getProject: fixture.project,
		importFiles: () => assert.fail('Allegro must use its importer') }, async () => fixture.service);
	await importer.importFiles([new File([text], 'Slow.gro')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	assert.equal(fixture.project().tempo.bpm, bpm < 1 ? 120 : bpm);
	const clip = fixture.project().clips[0]; assert.ok(clip);
	assert.deepEqual(readMidiClip(clip)?.interchange?.tempos, parsed.tempos);
	assert.deepEqual(readMidiClip(clip)?.notes, parsed.tracks[0]?.notes);
	assert.equal(clip.durationFrames, 24_000);
});

test('all supported MIDI meter values remain independently adoptable when its BPM is outside the project range', async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	await fixture.service.importDocument(parseMidiFile(source(1200, 255, 30), { sampleRate: 48_000 }));
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	assert.equal(fixture.project().tempo.bpm, 120);
	assert.deepEqual(fixture.project().tempo.timeSignature, { numerator: 255, denominator: 2 ** 30 });
});

for (const destination of ['timeline', 'project-bin'] as const) test(`importing fast MIDI to ${destination} retains the existing project clock`, async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	if (destination === 'timeline') await fixture.service.addTrack();
	fixture.apply({ type: 'tempo/set', bpm: 90, numerator: 5, denominator: 8 });
	await fixture.service.importDocument(parseMidiFile(source(1200), { sampleRate: 48_000 }), { destination });
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	assert.equal(fixture.project().tempo.bpm, 90);
	assert.deepEqual(fixture.project().tempo.timeSignature, { numerator: 5, denominator: 8 });
	const clip = destination === 'timeline' ? fixture.project().clips.at(-1) : fixture.project().projectBin.clips[0];
	assert.equal(readMidiClip(clip)?.interchange?.tempos[0]?.bpm, 1200);
});

test('optional conductor adoption does not swallow an unrelated import commit failure', async () => {
	const fixture = midiServiceFixture({ sampleRate: 48_000 });
	const failure = new Error('Storage is unavailable');
	const service = createMidiService({ ...fixture.dependencies, commit: () => { throw failure; } });
	await assert.rejects(service.importDocument(parseMidiFile(source(1200), { sampleRate: 48_000 })), error => error === failure);
	assert.equal(fixture.project().clips.length, 0);
	assert.equal(fixture.pcm.size, 0);
});
