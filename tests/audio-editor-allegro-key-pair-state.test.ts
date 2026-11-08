/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

// Expected pairs were independently checked with Audacity 3.7.7 PortSMF.
for (const { updates, expected } of [
	{ updates: "T0 -keysigi:3\nT1 -modea:'minor'", expected: [[8000, 3, 1]] },
	{ updates: "T1 -modea:'minor'\nT0 -keysigi:3", expected: [[8000, 3, 1]] },
	{ updates: "T0 -keysigi:3 -modea:'minor'\nT1 -modea:'major'\nT2 -keysigi:5", expected: [[0, 3, 1], [16_000, 5, 0]] },
	{ updates: "T0 -keysigi:3 -modea:'minor'", expected: [[0, 3, 1]] },
	{ updates: "T0 -keysigi:3 -keysigi:5 -modea:'minor'\nT1 -modea:'major'", expected: [[0, 5, 1], [8000, 3, 0]] },
]) test(`Allegro key parts wait for a complete pair: ${updates.replaceAll('\n', '; ')}`, async () => {
	const text = `#track 0 Key parts\nT0 -tempor:120\n${updates}\nT0 V0 P60 U3 L90\n`;
	const keys = (document: ReturnType<typeof parseMidiFile>) => document.tracks.flatMap(track => track.events ?? [])
		.filter(event => event.metaType === 89).map(event => [event.frame, ...event.data]);
	assert.deepEqual(keys(parseAllegroFile(text, { sampleRate: 8000 })), expected);
	const fixture = midiServiceFixture();
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('not audio') },
		async () => fixture.service).importFiles([new File([text], 'Key parts.gro')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.deepEqual(keys(parseMidiFile(bytes, { sampleRate: 8000 })), expected);
});

test('Allegro refuses unmatched key parts instead of inventing a key or mode', async () => {
	for (const update of ['T0 -keysigi:3', "T0 -modea:'minor'",
		"T0 -keysigi:3 -modea:'minor'\nT1 -modea:'major'"]) {
		const text = `#track 0 Incomplete key\nT0 -tempor:120\n${update}\nT0 V0 P60 U3 L90\n`;
		assert.throws(() => parseAllegroFile(text), /unmatched.*key signature/i);
		const fixture = midiServiceFixture();
		await assert.rejects(createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('not audio') },
			async () => fixture.service).importFiles([new File([text], 'Incomplete.gro')]), /unmatched.*key signature/i);
		assert.equal(fixture.project().tracks.length, 0);
	}
});
