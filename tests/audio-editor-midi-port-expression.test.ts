/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import type { MidiNote } from '../src/common/editor/midi-model.ts';

test('a valid note-bearing track keeps earlier port-zero volume setup away from port-one note PCM', async () => {
	const body = [0, 0xb0, 7, 0, 0, 255, 0x21, 1, 1, 0, 0x90, 69, 100, 0x83, 0x60, 0x80, 69, 0, 0, 255, 47, 0];
	const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, body.length, ...body]);
	const document = parseMidiFile(bytes, { sampleRate: 8000 });
	assert.equal(document.tracks[0]?.notes[0]?.midiPort, 1);
	const f = midiServiceFixture(); await f.service.importDocument(document);
	const clip = f.project().clips[0]; assert.ok(clip);
	assert.ok(f.pcm.get(clip.sourceId)?.[0]?.some(value => value !== 0));
});

test('sustain, panic and pitch bend isolate port namespaces while independent PCM windows remain identical', () => {
	const note: MidiNote = { id: 'port-one', midiPort: 1, channel: 0, pitch: 69, velocity: 100, startFrame: 0, durationFrames: 4000 };
	const events = [
		{ frame: 0, status: 0xb0, data: [64, 127] }, { frame: 0, status: 0xe0, data: [127, 127] },
		{ frame: 1000, status: 0xb0, data: [120, 0] },
	];
	const expected = renderMidiFrames([{ ...note, midiPort: undefined }], 'triangle', 8000, 0, 8000);
	assert.deepEqual(renderMidiFrames([note], 'triangle', 8000, 0, 8000, events), expected);
	assert.deepEqual(renderMidiFrames([note], 'triangle', 8000, 2000, 2000, events), expected.slice(2000, 4000));
});

test('new authored notes without a port inherit source selectors at their onset', () => {
	const note = { id: 'new', channel: 0, pitch: 69, velocity: 100, startFrame: 0, durationFrames: 4000 };
	const events = [{ frame: 0, status: 255, metaType: 0x21, data: [1] }, { frame: 0, status: 0xb0, data: [7, 0] }];
	assert.ok(renderMidiFrames([note], 'square', 8000, 0, 4000, events).every(value => value === 0));
	assert.ok(renderMidiFrames([{ ...note, midiPort: 0 }], 'square', 8000, 0, 4000, events).some(value => value !== 0));
});
