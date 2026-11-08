/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {writeMidiFile,parseMidiFile} from '../src/common/editor/midi-file.ts';
import {midiServiceFixture} from './helpers/midi-service-fixture.ts';
import {readMidiClip} from '../src/common/editor/midi-model.ts';

test('ordinary120BPM MIDI exported at48k imports exact positive half-frame points at8k',async()=>{
 const input=writeMidiFile({sampleRate:48000,tempos:[{frame:0,bpm:120}],signatures:[{frame:0,numerator:4,denominator:4}],tracks:[{name:'Piano',notes:[{id:'n',channel:0,pitch:60,velocity:100,startFrame:45,durationFrames:4800}]}]});
 const file=new File([Uint8Array.from(input)],'Piano.mid');
 const first=midiServiceFixture({sampleRate:48000});
 await first.service.importDocument(parseMidiFile(await file.arrayBuffer(),{sampleRate:48000}));
 assert.equal(readMidiClip(first.project().clips[0])?.notes[0]?.startFrame,45);
 await first.service.exportFile('midi');
 const output=first.saves[0]?.bytes;assert.ok(output instanceof Uint8Array);
 const second=midiServiceFixture();await second.service.importDocument(parseMidiFile(output,{sampleRate:8000}));
 const note=readMidiClip(second.project().clips[0])?.notes[0];assert.ok(note);
 //18ticks at9600PPQ and120BPM =7.5 target samples, point policy rounds to8.
 assert.equal(note.startFrame,8);
 assert.equal(note.durationFrames,800);
});

test('PPQ tempo changes retain unrounded accumulated numerators for notes, controls and conductor points', () => {
	const track = [0, 255, 81, 3, 7, 161, 32,
		18, 255, 81, 3, 11, 113, 176, 0, 0xb0, 7, 127,
		8, 0x90, 60, 100, 16, 0x80, 60, 0, 0, 255, 47, 0];
	const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 37, 128,
		77, 84, 114, 107, 0, 0, track.length >> 8, track.length & 255, ...track]);
	const document = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.deepEqual(document.tempos, [{ frame: 0, bpm: 120 }, { frame: 8, bpm: 80 }]);
	assert.equal(document.tracks[0]?.events?.[0]?.frame, 8);
	assert.deepEqual(document.tracks[0]?.notes.map(note => [note.startFrame, note.durationFrames]), [[13, 10]]);
	assert.equal(document.tracks[0]?.durationFrames, 23);
});
