/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

for (const fields of ['K64 Q', 'Q K64', 'K64 U0.1', 'K64']) test(`FileImport retains the native key-implied pitch of ${fields}`, async () => {
	assert.equal((await importedNotes(fields))[0]?.pitch, 64);
});

test('an explicit pitch remains independent of a note identifier', async () => {
	assert.equal((await importedNotes('K64 P72 Q'))[0]?.pitch, 72);
});

test('a duration-only note still inherits the previous pitch', async () => {
	assert.deepEqual((await importedNotes('P64 Q\nQ')).map(note => note.pitch), [64, 64]);
});

async function importedNotes(fields: string) {
	const fixture = midiServiceFixture();
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('GRO must use MIDI import') },
		async () => fixture.service).importFiles([new File([`#track 0\nT0 -tempor:120\nT0 V0 ${fields} L100\n`], 'Key duration.gro')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	const midi = readMidiClip(fixture.project().clips[0]); assert.ok(midi);
	return midi.notes;
}
