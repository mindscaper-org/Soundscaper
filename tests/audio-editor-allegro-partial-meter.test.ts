/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

// Independently checked with the unchanged Audacity 3.7.7 PortSMF reader/writer.
// Meter fields inherit during source declarations, before events are sorted.
for (const { updates, expected } of [
	{ updates: 'T0 -timesig_numr:3', expected: [[0, 3, 4]] },
	{ updates: 'T0 -timesig_denr:8', expected: [[0, 4, 8]] },
	{ updates: 'T0 -timesig_numr:3\nT1.5 -timesig_denr:8', expected: [[0, 3, 4], [12_000, 3, 8]] },
	{ updates: 'T1.5 -timesig_denr:8\nT0 -timesig_numr:3', expected: [[0, 3, 8], [12_000, 4, 8]] },
	{ updates: 'T0 -timesig_numr:3 -timesig_denr:8', expected: [[0, 3, 8]] },
	{ updates: 'T0 -timesig_numr:3\nT0 -timesig_denr:8', expected: [[0, 3, 8]] },
]) test(`Allegro meter updates inherit native state: ${updates.replaceAll('\n', '; ')}`, async () => {
	const text = `#track 0 Meter\nT0 -tempor:120\n${updates}\nT0 V0 P60 U3 L90\n`;
	const parsed = parseAllegroFile(text, { sampleRate: 8000 });
	assert.deepEqual(parsed.signatures.map(event => [event.frame, event.numerator, event.denominator]), expected);
	const fixture = midiServiceFixture();
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('Allegro must use MIDI import') },
		async () => fixture.service).importFiles([new File([text], 'Meter.gro')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes;
	assert.ok(bytes instanceof Uint8Array);
	assert.deepEqual(parseMidiFile(bytes, { sampleRate: 8000 }).signatures.map(event => [event.frame, event.numerator, event.denominator]), expected);
});
