/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';
import type { MidiClipData } from '../src/common/editor/midi-model.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';

for (const channel of [3, 9]) test(`selected note audition retains channel ${channel} and its imported program`, async () => {
	const f = midiServiceFixture();
	let actual: Float32Array[] | undefined;
	const service = createMidiService({ ...f.dependencies, async previewNote(pitch, instrument, _signal, data?: MidiClipData) {
		const render = await openMidiAudioRenderer({ ...data, version: 1, notes: [{ ...data?.notes[0], id: 'preview', pitch, velocity: 100,
			channel: data?.notes[0]?.channel ?? 0, startFrame: 0, durationFrames: 2800 }] }, instrument, 8000);
		try { actual = await render.render(0, 2800); } finally { await render.close(); }
	} });
	const [created] = await service.importDocument({ sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Patch',
		notes: [{ id: 'key', pitch: 60, channel, velocity: 100, startFrame: 1000, durationFrames: 4000 }], events: [
			{ frame: 0, status: 0xc0 | channel, data: [40] }, { frame: 6000, status: 0xc0 | channel, data: [0] },
		] }] });
	assert.ok(created?.trackId);
	await service.setInstrument(created.trackId, 'fluidsynth');
	await service.previewNote(67, 'fluidsynth', undefined, { clipId: created.clipId, noteId: 'key' });
	const reference = await openMidiAudioRenderer({ version: 1, notes: [{ id: 'preview', pitch: 67, velocity: 100, channel,
		startFrame: 0, durationFrames: 2800 }], interchange: { tempos: [], signatures: [], events: [{ frame: 0, status: 0xc0 | channel, data: [40] }] } }, 'fluidsynth', 8000);
	try { assert.deepEqual(actual, await reference.render(0, 2800)); } finally { await reference.close(); }
});
