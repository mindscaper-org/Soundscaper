/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

test('beat-positioned Allegro tempo declarations use the final earlier tempo', async () => {
 const file = new File(['#track 0 Earlier tempo last\nTQ4 -tempor:60\nT0 -tempor:120\nTQ5 V0 P60 Q\n'], 'Earlier tempo last.gro');
 const document = parseAllegroFile(await file.text(), {sampleRate:8000});
 assert.deepEqual(document.tempos.map(t=>[t.frame,t.bpm]),[[0,120],[16000,60]]);
 const f = midiServiceFixture();
 await f.service.importDocument(document);
 assert.deepEqual(readMidiClip(f.project().clips[0])?.notes.map(n=>[n.startFrame,n.durationFrames]),[[24000,8000]]);
});

test('many reverse-ordered beat tempo declarations settle without repeated whole-map sorting', () => {
	const count = 256;
	const text = Array.from({ length: count }, (_, index) => `TQ${count - index - 1} -tempor:120`).join('\n') + '\nTQ256 P60 Q\n';
	const original = Array.prototype.sort;
	let work = 0;
	Array.prototype.sort = function (compare) {
		if (this.length > 128) work += this.length;
		return original.call(this, compare);
	};
	try {
		const document = parseAllegroFile(text, { sampleRate: 8000 });
		assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[1_024_000, 4000]]);
		assert.ok(work <= count * 10, `${work} entries sorted for ${count} declarations`);
	} finally { Array.prototype.sort = original; }
});
