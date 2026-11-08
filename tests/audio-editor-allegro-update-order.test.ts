/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

// PortSMF prepends line attributes, then emits that linked list. Its unchanged
// reader -> SMF writer emits CC121, then CC11 here, leaving expression muted.
test('same-line Allegro updates preserve native evaluation order and muted PCM', async () => {
	const fixture = await imported('T0 V0 -control11r:0 -control121r:0');
	const clip = fixture.project().clips[0];
	assert.ok(clip);
	const data = readMidiClip(clip);
	assert.deepEqual(data?.interchange?.events.map(event => event.data), [[121, 0], [11, 0]]);
	const pcm = fixture.pcm.get(clip.sourceId);
	assert.ok(pcm);
	assert.ok(pcm.every(chunk => chunk.every(sample => sample === 0)));
	assert.ok(validateAudioEditorProjectV17(JSON.parse(JSON.stringify(fixture.project()))));
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.events ?? []).filter(event => event.status === 176)
		.map(event => event.data), [[121, 0], [11, 0]]);
});

test('repeated same-line Allegro controller attributes remain distinct updates', async () => {
	const fixture = await imported('T0 V0 -control96r:0 -control96r:0');
	assert.equal(readMidiClip(fixture.project().clips[0])?.interchange?.events.filter(event => event.data[0] === 96).length, 2);
});

test('separate Allegro update lines retain their source order and healthy audible reset', async () => {
	const fixture = await imported('T0 V0 -control11r:0\nT0 V0 -control121r:0');
	const clip = fixture.project().clips[0];
	assert.ok(clip);
	assert.deepEqual(readMidiClip(clip)?.interchange?.events.map(event => event.data), [[11, 0], [121, 0]]);
	assert.ok(fixture.pcm.get(clip.sourceId)?.some(chunk => chunk.some(sample => sample !== 0)));
});

async function imported(updates: string) {
	const fixture = midiServiceFixture();
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('Allegro must use MIDI import') },
		async () => fixture.service).importFiles([new File([`#track 0 Expression\nT0 -tempor:120\n${updates}\nT0 V0 P60 U0.5 L90\n`], 'Expression.gro')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	return fixture;
}
