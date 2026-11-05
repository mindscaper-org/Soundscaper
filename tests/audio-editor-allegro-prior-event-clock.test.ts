/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const unsupported = /earlier.*event.*clock|event.*retim/iu;

for (const event of ['T1 V0 P60 U0.5', 'T0 V0 P60 U0.5', 'T1 V0 -control7r:0', 'T1 V- -markers:"Before anchor"']) {
	test(`Allegro refuses a later anchor that would retime already-read ${event}`, () => {
		assert.throws(() => parseAllegroFile(`#track 0 Piano\n${event}\nT2 -beatr:4\nT3 V0 P62 U0.25\n`, { sampleRate: 8000 }), unsupported);
	});
}

test('FileImport refuses incompatible prior-event retiming before publishing a MIDI track', async () => {
	const fixture = midiServiceFixture();
	const importFiles = createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('GRO must use MIDI import') }, async () => fixture.service);
	await assert.rejects(importFiles.importFiles([new File(['#track 0 Piano\nT1 V0 P60 U0.5\nT2 -beatr:4\n'], 'Retimed Piano.gro')]), unsupported);
	assert.equal(fixture.project().clips.length, 0);
	await importFiles.importFiles([new File(['#track 0 Piano\nT2 -beatr:4\nT1 V0 P60 U0.5\n'], 'Anchored Piano.gro')]);
	assert.ok(validateAudioEditorProjectV17(JSON.parse(JSON.stringify(fixture.project()))));
	assert.deepEqual(readMidiClip(fixture.project().clips[0])?.notes.map(note => [note.startFrame, note.durationFrames]), [[8000, 4000]]);
});

test('beat-positioned notes remain supported when a later anchor faithfully retimes their beat identity', () => {
	const document = parseAllegroFile('TQ1 V0 P60 Q\nT2 -beatr:4\n', { sampleRate: 8000 });
	assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[4000, 4000]]);
});

test('late anchors that leave existing content unchanged retain numeric notes and auxiliary events', () => {
	const document = parseAllegroFile('T0 -tempor:120\nT1 V0 P60 U0.5\nT1 V0 -control7r:0.5\nT2 -beatr:4\n', { sampleRate: 8000 });
	assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[8000, 4000]]);
	assert.equal(document.tracks[0]?.events?.[0]?.frame, 8000);
});

test('source-coordinate admission compares combined offset points rather than rounded local times', () => {
	const document = parseAllegroFile('#offset 0.00003125\nT0 -tempor:120\nT1 V0 P60 U0.5\nT2 -beatr:4\n', { sampleRate: 8000 });
	assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[8000, 4000]]);
});

test('source beat validation keeps chronological numeric clocks bounded before a later identity anchor', () => {
	const count = 512;
	const text = Array.from({ length: count }, (_, index) => `T${index} -tempor:120\nT${index} V0 P60 U0.1`).join('\n')
		+ `\nT${count} -beatr:${count * 2}\n`;
	const original = Array.prototype.sort;
	let work = 0;
	Array.prototype.sort = function (compare) { work += this.length; return original.call(this, compare); };
	try {
		const document = parseAllegroFile(text, { sampleRate: 8000 });
		assert.equal(document.tracks[0]?.notes.length, count);
		assert.ok(work < count * 20, `${work} sorted entries for ${count} declarations`);
	} finally { Array.prototype.sort = original; }
});

test('unchanged source anchor points do not rebuild the same clock for each numeric note', () => {
	const count = 256;
	const text = 'T0 -tempor:120\n' + Array.from({ length: count }, (_, index) => `T${index} -beatr:${index * 2}\nT${index} V0 P60 U0.1`).join('\n');
	const original = Array.prototype.sort;
	let work = 0;
	Array.prototype.sort = function (compare) { work += this.length; return original.call(this, compare); };
	try {
		const document = parseAllegroFile(text, { sampleRate: 8000 });
		assert.equal(document.tracks[0]?.notes.length, count);
		assert.ok(work < count * 20, `${work} sorted entries for ${count} unchanged anchors`);
	} finally { Array.prototype.sort = original; }
});

for (const event of ['T1 V0 P60 U0.5', 'T1 V0 -control7r:0']) {
	test(`a late tempo-only mutation refuses prior-event retiming of ${event}`, () => {
		assert.throws(() => parseAllegroFile(`${event}\nT0 -tempor:120\n`, { sampleRate: 8000 }), unsupported);
	});
}

test('a later tempo declaration outside an earlier note keeps the original coordinates', () => {
	const document = parseAllegroFile('T1 V0 P60 U0.5\nT2 -tempor:120\n', { sampleRate: 8000 });
	assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[8000, 4000]]);
});

test('late unchanged origin tempo retains numeric notes and source beat identities', () => {
	const document = parseAllegroFile('T1 V0 P60 U0.5\nT0 -tempor:100\n', { sampleRate: 8000 });
	assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[8000, 4000]]);
});

test('an unchanged numeric half-sample point does not acquire a floating beat roundtrip refusal', () => {
	for (const conductor of ['', 'T0 -tempor:60\n']) {
		const document = parseAllegroFile(`${conductor}T0.0009375 V0 P60 U0.125\n`, { sampleRate: 8000 });
		assert.equal(document.tracks[0]?.notes[0]?.startFrame, 8);
	}
});

test('a pending key part is not an emitted signature before its later mode completes the pair', () => {
	const document = parseAllegroFile("T1 V- -keysigi:2\nT2 -beatr:4\nT3 V- -modea:'minor'\nT3 V0 P60 U0.5\n", { sampleRate: 8000 });
	assert.deepEqual(document.tracks[0]?.events?.filter(event => event.metaType === 89).map(event => [event.frame, event.data]), [[24_000, [2, 1]]]);
});

test('a completed earlier key signature still refuses unsupported retiming by a later anchor', () => {
	assert.throws(() => parseAllegroFile("T1 V- -keysigi:2 -modea:'minor'\nT2 -beatr:4\nT3 V0 P60 U0.5\n", { sampleRate: 8000 }), unsupported);
});
