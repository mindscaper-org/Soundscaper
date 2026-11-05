/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

test('MIDI import preserves a later conductor end through note edits and instrument rendering', async () => {
	const f = midiServiceFixture();
	const bytes = Uint8Array.from(Buffer.from(
		'4d546864000000060001000201e04d54726b0000000c00ff510307a1209e00ff2f004d54726b0000000d00903c648740803c0000ff2f00', 'hex'));
	const created = await f.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	assert.equal(created.length, 1, 'the empty conductor is not an audible track');
	assert.equal(f.project().clips[0]?.durationFrames, 32000);
	const { trackId, clipId } = created[0]!;
	assert.ok(trackId);
	await f.service.updateNote(clipId, readMidiClip(f.project().clips[0])!.notes[0]!.id, { pitch: 67 });
	await f.service.setInstrument(trackId, 'sine');
	const clip = f.project().clips[0]!;
	assert.equal(clip.durationFrames, 32000);
	assert.equal(f.project().sources.find(source => source.id === clip.sourceId)?.frameCount, 32000);
});
