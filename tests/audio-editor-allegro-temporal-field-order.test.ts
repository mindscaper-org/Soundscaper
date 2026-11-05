/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const conductor = '#track 0 Field order\nT0 -tempor:60\nT1 -tempor:120\nT0\n';
const values = (notes: readonly Readonly<{ startFrame: number; durationFrames: number }>[]) =>
	notes.map(note => [note.startFrame, note.durationFrames]);

test('Allegro duration before T evaluates at the previous cursor before changing note onset', async () => {
	// Unchanged PortSMF reads Q at old time0 (one second at60BPM), then T1
	// changes only the onset; the following implicit note starts at two seconds.
	const fixture = await imported(`${conductor}Q T1 V0 P60 L100\nP62 U0.125\n`);
	assert.deepEqual(values(readMidiClip(fixture.project().clips[0])!.notes), [[8000, 8000], [16000, 1000]]);
	assert.ok(validateAudioEditorProjectV17(JSON.parse(JSON.stringify(fixture.project()))));
	await fixture.service.exportFile('midi');
	const bytes = fixture.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	assert.deepEqual(values(parseMidiFile(bytes, { sampleRate: 8000 }).tracks.flatMap(track => track.notes)), [[8000, 8000], [16000, 1000]]);
});

test('Allegro next interval before T evaluates against its original cursor clock', async () => {
	const fixture = await imported(`${conductor}NQ T1 V0 P60 U0.125 L100\nP62 U0.125\n`);
	assert.deepEqual(values(readMidiClip(fixture.project().clips[0])!.notes), [[8000, 1000], [16000, 1000]]);
});

test('ordinary time-first and numeric duration fields retain their supported timing', () => {
	for (const [fields, duration, next] of [['T1 Q', 4000, 12000], ['U0.25 T1', 2000, 10000]] as const) {
		const parsed = parseAllegroFile(`${conductor}${fields} V0 P60 L100\nP62 U0.125\n`, { sampleRate: 8000 });
		assert.deepEqual(values(parsed.tracks[0]!.notes), [[8000, duration], [next, 1000]]);
	}
});

test('lexical durations retain exact offsets and a consistent authored anchor clock', () => {
	const parsed = parseAllegroFile('#offset 0.125\n#track 0 Anchored\nT0 -beatr:0\nT0 -tempor:60\nT1 -tempor:120\nT2 -beatr:3\nT0\nUQ T1 V0 P60 L100\nP62 U0.125\n', { sampleRate: 8000 });
	assert.deepEqual(values(parsed.tracks[0]!.notes), [[9000, 8000], [17000, 1000]]);
});

test('a repeated explicit Allegro time remains an admission error', () => {
	assert.throws(() => parseAllegroFile(`${conductor}Q T1 T2 V0 P60\n`, { sampleRate: 8000 }), /time is specified twice/u);
});

async function imported(text: string) {
	const fixture = midiServiceFixture();
	await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('Allegro must use MIDI import') },
		async () => fixture.service).importFiles([new File([text], 'Field order.gro')]);
	assert.ok(validateAudioEditorProjectV17(fixture.project()));
	return fixture;
}
