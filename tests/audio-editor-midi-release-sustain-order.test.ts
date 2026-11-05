/* SPDX-License-Identifier: AGPL-3.0-only */
import	assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { createMidiImportFiles } from '../src/common/editor/controller/composition/internal/midi-import-files.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

const diagnostic = /sustain.*key.release.*order/iu;
const on = [0, 144, 69, 100], off = [0x87, 0x40, 128, 69, 0];
const pedal = (value: number, delta = 0, channel = 0): number[] => [delta, 176 | channel, 64, value];
function file(body: readonly number[], division = 480): Uint8Array<ArrayBuffer> {
	const events = [...body, 0, 255, 47, 0];
	return Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,division >> 8,division & 255,
		77,84,114,107,0,0,events.length >> 8,events.length & 255,...events]);
}
for (const release of [[...off], [0x87,0x40,144,69,0], [0x87,0x40,176,123,0]]) {
	test(`import refuses a pedal press after an already completed key release ${String(release[2])}`, () => {
		assert.throws(() => parseMidiFile(file([...on,...release,...pedal(127),...pedal(0,120)])), diagnostic);
	});
}
test('public MIDI import refuses the changed sustain before publishing fallback media', async () => {
	const f=midiServiceFixture();
	const importer=createMidiImportFiles({getProject:f.project,importFiles:()=>assert.fail('MIDI must use its importer')},async()=>f.service);
 await	assert.rejects(importer.importFiles([new File([file([...on,...off,...pedal(127),...pedal(0,120)])],'Late sustain.mid')]),diagnostic);
	assert.equal(f.project().clips.length,0);	assert.equal(f.pcm.size,0);
});
test('sample rounding cannot move a later pedal press before an earlier release', () => {
	assert.throws(()=>parseMidiFile(file([...on,...off,...pedal(127,1),...pedal(0,120)],32767),{sampleRate:8000}),diagnostic);
});
for (const body of [
 [...on,...off,...pedal(127,1),...pedal(0,120)],
 [...on,0x87,0x40,176,64,127,0,128,69,0,...pedal(0,120)],
 [...on,...off,...pedal(127),...pedal(0),0x78,176,7,100],
 [...on,...off,...pedal(127),0,176,120,0,0x78,176,7,100],
 [...on,...off,...pedal(127,0,1),...pedal(0,120,1)],
 [...on,...off,0,255,33,1,1,...pedal(127),...pedal(0,120)],
 [0,128,69,0,...pedal(127),...on,120,128,69,0,...pedal(0)],
])	test(`representable sustain order stays admitted ${JSON.stringify(body)}`,()=>assert.doesNotThrow(()=>parseMidiFile(file(body))));
