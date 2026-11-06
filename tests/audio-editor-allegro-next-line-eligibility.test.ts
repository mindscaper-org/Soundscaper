/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

for (const [fields, startFrame] of [
	['N0.5', 0], ['T1 N0.5', 8000], ['V0 N0.5', 0], ['N0.5 T1 V0', 8000],
] as const) test(`a non-event Allegro line does not apply its next interval: ${fields}`, () => {
	const document = parseAllegroFile(`#track 0\n${fields}\nV0 P60 U0.25\n`, { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.notes[0]?.startFrame, startFrame);
	assert.equal(document.tracks[0]?.notes[0]?.durationFrames, 2000);
});

for (const fields of ['V0 P62 U0.125 N0.5', 'V0 -control7r:1.0 N0.5', 'L80 N0.5', 'K128 N0.5']) {
	test(`a genuine Allegro event applies its next interval: ${fields}`, () => {
		const document = parseAllegroFile(`#track 0\nT0 ${fields}\nV0 P60 U0.25\n`, { sampleRate: 8000 });
		assert.equal(document.tracks[0]?.notes.at(-1)?.startFrame, 4000);
	});
}

test('an ignored next interval retains the explicit time and source offset', () => {
	const document = parseAllegroFile('#offset 0.125\n#track 0\nT1 N0.5\nV0 P60 U0.25\n', { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.notes[0]?.startFrame, 9000);
});

test('public Allegro import, PCM publication and MIDI delivery retain the native onset', async () => {
	const fixture = midiServiceFixture();
	const importer = createMidiImportFiles({ getProject: fixture.project,
		importFiles: () => assert.fail('Allegro must use its MIDI import route') }, async () => fixture.service);
	await importer.importFiles([new File(['#track 0\nN0.5\nV0 P60 U0.25\n'], 'Next interval.gro')]);
	const project = fixture.project();
	assert.ok(validateAudioEditorProjectV17(project));
	const clip = project.clips[0]; assert.ok(clip);
	assert.equal(readMidiClip(clip)?.notes[0]?.startFrame, 0);
	const chunks = fixture.pcm.get(clip.sourceId); assert.ok(chunks);
	assert.ok(chunks[0]!.slice(0, 1000).some(value => Math.abs(value) > .01));
	assert.equal(project.sources.find(source => source.id === clip.sourceId)?.frameCount, 2000);
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	assert.equal(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes)[0]?.startFrame, 0);
});
