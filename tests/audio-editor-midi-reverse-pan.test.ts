/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { channelEnergy, midiPanTrajectory } from './helpers/midi-pan-trajectory.ts';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import { readMidiClip, type MidiClipData } from '../src/common/editor/midi-model.ts';

async function render(data: MidiClipData) {
	const renderer = await openMidiAudioRenderer(data, 'fluidsynth', 8000);
	try { return await renderer.render(0, 16000); } finally { await renderer.close(); }
}

test('reversing a recorded MIDI pan trajectory preserves the actual stereo instrument positions on delivery', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(writeMidiFile(midiPanTrajectory()), { sampleRate: 8000 }));
	await f.service.setInstrument(f.project().tracks[0]!.id, 'fluidsynth');
	const clip = f.project().clips[0]!;
	const source = await render(readMidiClip(clip)!);
	assert.ok(channelEnergy(source[0]!, 3000, 4000) > channelEnergy(source[1]!, 3000, 4000) * 10);
	assert.ok(channelEnergy(source[1]!, 11000, 12000) > channelEnergy(source[0]!, 11000, 12000) * 10);
	f.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const recipient = midiServiceFixture();
	await recipient.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	await recipient.service.setInstrument(recipient.project().tracks[0]!.id, 'fluidsynth');
	const output = await render(readMidiClip(recipient.project().clips[0])!);
	assert.ok(channelEnergy(output[1]!, 3500, 4500) > channelEnergy(output[0]!, 3500, 4500) * 10, 'the reversed first voice must be on the right');
	assert.ok(channelEnergy(output[0]!, 12000, 13000) > channelEnergy(output[1]!, 12000, 13000) * 10, 'the reversed second voice must be on the left');
});
