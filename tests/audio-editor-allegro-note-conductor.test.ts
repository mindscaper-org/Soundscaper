/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

test('Allegro import refuses mixed note/conductor evaluation before publishing altered note timing', async () => {
	for (const update of ['-tempor:60', '-beatr:0']) {
		const file = new File([`#track 0 Same line clock\nT0 V0 P60 Q ${update}\nP62 Q\n`], 'Same line clock.gro');
		const f = midiServiceFixture();
		const original = f.project();
		await assert.rejects(async () => f.service.importDocument(parseAllegroFile(await file.text(), { sampleRate: 8000 })),
			/note.*conductor|conductor.*note/iu);
		assert.equal(f.project(), original);
		assert.equal(f.pcm.size, 0);
	}
});

test('ordinary separate Allegro conductor and note lines remain supported', () => {
	const document = parseAllegroFile('T0 -tempor:60\nT0 V0 P60 Q\nP62 Q\n', { sampleRate: 8000 });
	assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[0, 8000], [8000, 8000]]);
});
