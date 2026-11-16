/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chaseMidiAudioEvents } from '../src/common/editor/engine/midi-audio-events.ts';
import { openMidiLibraryRenderer } from '../src/common/editor/engine/midi-library-renderer.ts';

test('live seeking chases patch/controller order and held or sustained keys without replaying audio history', async () => {
	const events = [
		{ frame: 0, data: [0xb0, 0, 2] }, { frame: 1, data: [0xc0, 12] }, { frame: 2, data: [0xb0, 0, 3] },
		{ frame: 3, data: [0x90, 60, 100] }, { frame: 4, data: [0xb0, 64, 127] }, { frame: 5, data: [0x80, 60, 0] },
		{ frame: 6, data: [0x90, 67, 90] },
	];
	assert.deepEqual(chaseMidiAudioEvents(events, 100).map(event => event.data), [
		[0xb0, 0, 2], [0xc0, 12], [0xb0, 0, 3], [0xb0, 64, 127], [0x90, 60, 100], [0x90, 67, 90], [0x80, 60, 0],
	]);
	const received: number[][] = [], generated: number[] = [];
	const renderer = await openMidiLibraryRenderer({ version: 1, notes: [{ id: 'held', pitch: 69, channel: 0, velocity: 100, startFrame: 0, durationFrames: 48000 * 3600 }] },
		async () => ({ send: bytes => { received.push([...bytes]); }, render: channels => {
			generated.push(channels[0]!.length); if (generated.length > 1) throw new Error('A cold live seek replayed audio history.');
		}, close: () => undefined }), 48000 * 1800);
	try { await renderer.render(48000 * 1800, 1024); assert.deepEqual(generated, [1024]); assert.deepEqual(received, [[0x90, 69, 100]]); }
	finally { await renderer.close(); }
});

test('pedal release, reset and panic cannot resurrect released keys during chase', () => {
	for (const control of [[64, 0], [120, 0], [121, 0]]) {
		const events = [{ frame: 0, data: [0x90, 60, 100] }, { frame: 1, data: [0xb0, 64, 127] },
			{ frame: 2, data: [0x80, 60, 0] }, { frame: 3, data: [0xb0, ...control] }];
		assert.ok(chaseMidiAudioEvents(events, 10).every(event => (event.data[0]! & 240) !== 0x90));
	}
});
