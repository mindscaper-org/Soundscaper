/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiDocumentFromProject } from '../src/common/editor/midi-project-interchange.ts';
import { writeAllegroFile } from '../src/common/editor/allegro-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

for (const [name, clocks, thirtySeconds] of [['metronome click', 36, 8], ['notation clock', 24, 12]] as const) {
	test(`a compound-meter MIDI roundtrip retains the declared ${name}`, async () => {
		const events = [0, 0xff, 0x58, 4, 6, 3, clocks!, thirtySeconds!, 0, 0x90, 60, 90,
			0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
		const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224,
			77, 84, 114, 107, 0, 0, 0, events.length, ...events]);
		const f = midiServiceFixture();
		await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
		const output = writeMidiFile(midiDocumentFromProject({ ...f.project() }));
		const signature = Buffer.from(output).indexOf(Buffer.from([0xff, 0x58, 4]));
		assert.ok(signature > 0);
		assert.deepEqual([...output.subarray(signature + 3, signature + 7)], [6, 3, clocks, thirtySeconds]);
		assert.throws(() => writeAllegroFile(midiDocumentFromProject({ ...f.project() })), /cannot be represented in Allegro/u);
	});
}
