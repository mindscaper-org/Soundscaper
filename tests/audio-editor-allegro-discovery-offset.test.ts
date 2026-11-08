/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAllegroFile } from '../src/common/editor/allegro-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

test('later tempo declarations resolve beat timing before negative-offset admission', async () => {
 const text = '#offset -1\n#track 0 Later tempo\nTQ1 V0 P60 Q\nT0 -tempor:30\n';
 const file = new File([text], 'Later tempo.gro');
 const f = midiServiceFixture();
 await f.service.importDocument(parseAllegroFile(await file.text(), {sampleRate:8000}));
 assert.deepEqual(readMidiClip(f.project().clips[0])?.notes.map(n=>[n.startFrame,n.durationFrames]),[[8000,16000]]);
});

test('resolved negative Allegro note positions still refuse admission', () => {
	assert.throws(() => parseAllegroFile('#offset -1\nTQ1 P60 Q\nT0 -tempor:120\n', { sampleRate: 8000 }), /note time/u);
});
