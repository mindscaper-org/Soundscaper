/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

function score(count: number, anchor: boolean): string {
	return '#track 0 Tempo preparation\n' + (anchor ? 'T0 -beatr:0\n' : '')
		+ Array.from({ length: count }, (_, index) => `TQ${index / 100} -tempor:${120 + index % 2 * 10}\n`).join('')
		+ 'T0 V0 P60 U0.125 L100\n';
}

test('an identity origin anchor preserves FileImport authoring and PCM without quadratic tempo preparation', async () => {
	const count = 1024; let control = '', controlPcm = '';
	for (const anchor of [false, true]) {
		const fixture = midiServiceFixture(); const original = Array.prototype.sort; let work = 0;
		Array.prototype.sort = function(compare) { work += this.length; return original.call(this, compare); };
		try {
			await createMidiImportFiles({ getProject: fixture.project, importFiles: () => assert.fail('GRO must use MIDI import') },
				async () => fixture.service).importFiles([new File([score(count, anchor)], 'Tempo preparation.gro')]);
		} finally { Array.prototype.sort = original; }
		assert.ok(validateAudioEditorProjectV17(JSON.parse(JSON.stringify(fixture.project()))));
		const clip = fixture.project().clips[0]; assert.ok(clip);
		const data = readMidiClip(clip); assert.ok(data);
		assert.equal(data.interchange?.tempos.length, count);
		const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
		const samples = createHash('sha256');
		for (const chunk of fixture.pcm.get(clip.sourceId) ?? []) samples.update(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
		const pcm = samples.digest('hex');
		if (control) { assert.equal(hash, control); assert.equal(pcm, controlPcm); }
		else { control = hash; controlPcm = pcm; }
		assert.ok(work < count * 40, `${work} elements sorted for ${count} tempo declarations`);
	}
});

test('quoted anchor-looking text cannot change the discovery clock', () => {
	const text = 'T0 V- -texts:"literal -beatr:7 and -tempor:42"\n';
	const plain = parseAllegroFile(text + score(128, false), { sampleRate: 8000 });
	const anchored = parseAllegroFile(text + score(128, true), { sampleRate: 8000 });
	assert.deepEqual(anchored, plain);
	assert.throws(() => parseAllegroFile('T0 V- -texts:"unfinished -beatr:7'), /Allegro line 1.*Unterminated/iu);
});

test('non-origin anchors and nonzero offsets retain their existing authored clocks', () => {
	const input = '#track 0 Nonidentity\nT0 -beatr:0\nT0 -tempor:60\nT1 -beatr:2\nT0 V0 P60 Q\n';
	for (const offset of [0, 0.125]) {
		const parsed = parseAllegroFile(`#offset ${offset}\n${input}`, { sampleRate: 8000 });
		assert.deepEqual(parsed.tempos, [...(offset ? [{ frame: 0, bpm: 120 }] : []),
			{ frame: offset * 8000, bpm: 120 }, { frame: 8000 + offset * 8000, bpm: 60 }]);
		assert.equal(parsed.tracks[0]?.notes[0]?.startFrame, offset * 8000);
		assert.equal(parsed.tracks[0]?.notes[0]?.durationFrames, 4000);
	}
	assert.deepEqual(parseAllegroFile('#offset 0.125\n' + score(128, true), { sampleRate: 8000 }),
		parseAllegroFile('#offset 0.125\n' + score(128, false), { sampleRate: 8000 }));
});

test('numeric-positive and implicit tempo positions keep their exact current interpretation', () => {
	for (const declaration of ['T1 -tempor:60', 'T1\n-tempor:60']) {
		const parsed = parseAllegroFile(`T0 -beatr:0\nT0 -tempor:120\n${declaration}\nTQ3 V0 P60 Q\n`, { sampleRate: 8000 });
		assert.deepEqual(parsed.tempos, [{ frame: 0, bpm: 120 }, { frame: 8000, bpm: 60 }]);
		assert.deepEqual(parsed.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[16000, 8000]]);
	}
});

test('identity-anchor preparation does not admit retroactive mixed clock mutations', () => {
	assert.throws(() => parseAllegroFile('T0 -beatr:0\nTQ2 -tempor:120\nTQ1 -tempor:60\nT0 V0 P60 U1\n'), /retroactive.*clock/iu);
});
