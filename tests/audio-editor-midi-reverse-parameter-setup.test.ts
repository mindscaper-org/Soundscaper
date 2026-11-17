/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import { parseMidiFile, writeMidiFile } from '../src/common/editor/midi-file.ts';
import { readMidiClip, type MidiClipData } from '../src/common/editor/midi-model.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { midiPitchRangeSetup } from './helpers/midi-parameter-setup-fixture.ts';

async function pitch(data: MidiClipData, start = 4000): Promise<number> {
	const renderer = await openMidiAudioRenderer(data, 'fluidsynth', 8000);
	try {
		const channels = await renderer.render(0, start + 4096);
		return calculateAudioSpectrum(channels.map(channel => channel.subarray(start)), 8000, { size: 4096 }).bins
			.reduce((peak, bin) => bin.amplitude > peak.amplitude ? bin : peak).frequency;
	} finally { await renderer.close(); }
}

test('reversed MIDI retains an onset RPN pitch range before the first delivered note', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(writeMidiFile(midiPitchRangeSetup()), { sampleRate: 8000 }));
	const clip = f.project().clips[0]!;
	const original = await pitch(readMidiClip(clip)!);
	assert.ok(original > 500 && original < 540, `source octave bend ${String(original)}`);
	f.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
	await f.service.exportFile('midi');
	const bytes = f.saves[0]?.bytes; assert.ok(bytes instanceof Uint8Array);
	const recipient = midiServiceFixture(); await recipient.service.importDocument(parseMidiFile(bytes, { sampleRate: 8000 }));
	const delivered = await pitch(readMidiClip(recipient.project().clips[0])!);
	assert.ok(Math.abs(delivered - original) < 2, `delivered pitch ${String(delivered)} must retain source ${String(original)}`);
});

test('a reversed changing RPN programme is refused instead of delivering the wrong sounding pitch', async () => {
	const f = midiServiceFixture();
	await f.service.importDocument(parseMidiFile(writeMidiFile(midiPitchRangeSetup(true)), { sampleRate: 8000 }));
	const clip = f.project().clips[0]!, data = readMidiClip(clip)!;
	assert.ok((await pitch(data, 1000)) < 300);
	assert.ok((await pitch(data, 10000)) > 500);
	f.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: true } });
	for (const format of ['midi', 'allegro'] as const) await assert.rejects(f.service.exportFile(format), /Reversed MIDI parameter/);
	assert.equal(f.saves.length, 0);
	f.apply({ type: 'clip/update', clipId: clip.id, changes: { reversed: false } });
	await f.service.exportFile('midi'); assert.equal(f.saves.length, 1);
});
