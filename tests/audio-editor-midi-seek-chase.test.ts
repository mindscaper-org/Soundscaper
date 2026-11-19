/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chaseMidiAudioEvents, compileMidiAudioTimeline } from '../src/common/editor/engine/midi-audio-events.ts';
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

test('ordinary controllers do not scan every currently sounding key during MIDI chase', () => {
	let reads = 0;
	const notes = Array.from({ length: 512 }, (_, index) => new Proxy([0x90 | index % 4, index % 128, 100], {
		get(target, key, receiver) {
			if (key === '0') reads++;
			return Reflect.get(target, key, receiver);
		},
	}));
	const controllers = Array.from({ length: 512 }, (_, index) => [0xb0 | index % 4, 11, index % 128]);
	const chased = chaseMidiAudioEvents([...notes, ...controllers].map((data, frame) => ({ frame, data })), 1024);
	assert.ok(reads < 4 * notes.length, `chase inspected sounding keys ${reads} times`);
	assert.deepEqual(chased.map(event => event.data), [...controllers, ...notes]);
});

test('compiled MIDI event timelines fill their typed packet without boxed planes', context => {
	const floatCopies = context.mock.method(Float64Array, 'from');
	const packedCopies = context.mock.method(Uint32Array, 'from');
	const timeline = compileMidiAudioTimeline({
		version: 1, notes: [{ id: 'played', pitch: 69, channel: 0, velocity: 100, startFrame: 2, durationFrames: 15 }],
		interchange: { events: [{ status: 0xc0, frame: 0, data: [8] }, { status: 0xb0, frame: 9, data: [11, 90] }],
			tempos: [], signatures: [] },
	}, 9);
	assert.deepEqual([...timeline.frames], [0, 0, 0, 8]);
	assert.deepEqual([...timeline.messages], [0x020008c0, 0x03644590, 0x035a0bb0, 0x03004580]);
	assert.equal(floatCopies.mock.callCount() + packedCopies.mock.callCount(), 0);
});

test('library MIDI sequential seeks reuse discarded PCM without returning those buffers', async () => {
	const buffers: ArrayBuffer[] = [];
	let position = 0;
	const renderer = await openMidiLibraryRenderer({ version: 1, notes: [] }, async () => ({
		send: () => {}, close: () => {},
		render(channels) {
			buffers.push(channels[0]!.buffer);
			assert.equal(channels[0]![0], 0, 'each rendered span begins with clean PCM');
			channels[0]!.fill(position + 1);
			position += channels[0]!.length;
		},
	}));
	try {
		const first = await renderer.render(4300, 32);
		const next = await renderer.render(4332, 8);
		assert.equal(new Set(buffers.slice(0, 5)).size, 1);
		assert.notEqual(first[0]!.buffer, buffers[0]);
		assert.equal(first[0]![0], 4301);
		assert.equal(next[0]![0], 4333);
	} finally { await renderer.close(); }
});
