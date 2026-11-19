/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiDemandSource } from '../src/common/editor/engine/midi-demand-source.ts';
import { createMidiRenderer } from '../src/common/editor/engine/midi-synthesis.ts';

const data = { version: 1 as const, notes: [{ id: 'a', pitch: 69, velocity: 100, channel: 0, startFrame: 0, durationFrames: 8000 }] };

test('MIDI demand rendering is lazy, deduplicates reads and protects cached samples from transfer/mutation', async () => {
	let opened = 0, renders = 0, closed = 0;
	const source = new MidiDemandSource({ frameCount: 8000, channelCount: 1, chunkFrames: 1024 }, async () => {
		opened++;
		const render = createMidiRenderer(data.notes, 'sine', 8000);
		return { channelCount: 1, render: async (start, frames) => { renders++; return [render(start, frames)]; }, close: async () => { closed++; } };
	}, 8192);
	assert.equal(opened, 0);
	const [first, concurrent] = await Promise.all([source.chunk(0), source.chunk(0)]);
	assert.equal(renders, 1);
	assert.deepEqual(first.channels, concurrent.channels);
	assert.ok(first.channels[0]!.some(value => value !== 0));
	const expected = first.channels[0]![50];
	first.channels[0]!.fill(0);
	assert.equal((await source.chunk(0)).channels[0]![50], expected);
	await source.close();
	assert.equal(closed, 1);
	await assert.rejects(source.chunk(0), /closed/);
});

test('bounded cache evicts old chunks and a cancelled read does not retire another reader', async () => {
	let renders = 0;
	const source = new MidiDemandSource({ frameCount: 3000, channelCount: 1, chunkFrames: 1024 }, async () => ({
		channelCount: 1, render: async (_start, frames) => { renders++; return [new Float32Array(frames).fill(0.25)]; }, close: async () => undefined,
	}), 4096);
	await source.chunk(0);
	await source.chunk(1);
	assert.equal(source.cachedBytes, 4096);
	await source.chunk(0);
	assert.equal(renders, 3);
	const abort = new AbortController(); abort.abort();
	await assert.rejects(source.chunk(0, abort.signal), { name: 'AbortError' });
	assert.equal((await source.chunk(2)).frames, 952);
	assert.ok(source.cachedBytes <= 4096);
	await source.close();
});

test('invalid windows and corrupt instrument output cannot enter the cache', async () => {
	const source = new MidiDemandSource({ frameCount: 2000, channelCount: 1, chunkFrames: 1024 }, async () => ({
		channelCount: 1, render: async (_start, frames) => [new Float32Array(frames).fill(NaN)], close: async () => undefined,
	}));
	await assert.rejects(source.chunk(2), RangeError);
	await assert.rejects(source.chunk(0), /invalid PCM/);
	assert.equal(source.cachedBytes, 0);
	await source.close();
});
