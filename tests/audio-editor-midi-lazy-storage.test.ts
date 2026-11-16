/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { renderMidiFrames } from '../src/common/editor/engine/midi-synthesis.ts';
import { NodeMidiWorker } from './helpers/node-midi-worker.ts';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { openMidiAudioRenderer } from '../src/common/editor/engine/midi-audio-renderer.ts';

const data = { version: 1 as const, notes: [{ id: 'note', pitch: 69, velocity: 100, channel: 0, startFrame: 0, durationFrames: 3000 }] };

test('a durable MIDI score publishes without PCM; streamed and reopened reads synthesize exact windows off thread', async () => {
	const original = globalThis.Worker;
	let workers = 0;
	globalThis.Worker = class extends NodeMidiWorker { constructor() { super(); workers++; } } as unknown as typeof Worker;
	const options = { indexedDB: null, databaseName: `midi-lazy-${crypto.randomUUID()}` };
	let store = createProjectStore(options);
	try {
		const record = await store.writeMidiSource('midi', { data, instrument: 'sine', sampleRate: 8000 }, { frameCount: 4000 });
		assert.equal(record.storage, 'midi-generated-v1');
		assert.equal(workers, 0, 'publication must not open a renderer or compute waveforms');
		assert.equal(store.memory.sourceChunks.size, 0);
		const second = await store.readSourceChunk('midi', 1);
		assert.deepEqual(second.channels[0], renderMidiFrames(data.notes, 'sine', 8000, 1024, 1024));
		assert.equal(workers, 1);
		const session = await store.openSourceReadSession('midi');
		assert.ok(session);
		const first = await session.chunk(0);
		const again = await session.chunk(0);
		assert.deepEqual(first.channels, again.channels);
		assert.notEqual(first.channels[0]!.buffer, again.channels[0]!.buffer);
		await session.release();
		await store.close();
		store = createProjectStore(options);
		let frames = 0;
		for await (const chunk of store.readSourceChunks('midi')) frames += chunk.frames;
		assert.equal(frames, 4000, 'archive/export readers can materialize the complete source');
		assert.equal(workers, 2);
	} finally { await store.close(); globalThis.Worker = original; }
});

test('MIDI edits publish immediately into the real store without allocating a synthesizer', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `midi-edit-lazy-${crypto.randomUUID()}` });
	const fixture = midiServiceFixture();
	const service = createMidiService({ ...fixture.dependencies, store });
	try {
		const { clipId, trackId } = await service.addTrack();
		await service.addNote(clipId, { ...data.notes[0]!, durationFrames: 8000 * 3600 });
		await service.setInstrument(trackId, 'square');
		assert.equal(store.memory.sourceChunks.size, 0);
		assert.equal(fixture.project().clips[0]!.sourceDurationFrames, 8000 * 3600);
		assert.ok([...store.memory.sources.values()].every(value => (value as { storage: string }).storage === 'midi-generated-v1'));
	} finally { await store.close(); }
});

test('live seek cache origins cannot contaminate canonical export samples', async () => {
	const original = globalThis.Worker; globalThis.Worker = NodeMidiWorker as unknown as typeof Worker;
	const store = createProjectStore({ indexedDB: null, databaseName: `midi-origins-${crypto.randomUUID()}` });
	const score = { ...data, notes: [{ ...data.notes[0]!, durationFrames: 48000 * 3600 }] };
	try {
		await store.writeMidiSource('fluid', { data: score, instrument: 'fluidsynth', sampleRate: 48000 }, { frameCount: 48000 * 3600 });
		const session = await store.openSourceReadSession('fluid'); assert.ok(session);
		const live = await session.chunk(1, { renderStartFrame: 1024 });
		await session.chunk(0);
		const canonical = await session.chunk(1);
		const independent = await openMidiAudioRenderer(score, 'fluidsynth', 48000);
		try {
			const expected = await independent.render(0, 2048);
			assert.deepEqual(canonical.channels[0], expected[0]!.subarray(1024));
			assert.notDeepEqual(live.channels[0], canonical.channels[0], 'a chased attack is distinct from a continuously rendered voice');
		} finally { await independent.close(); }
		await session.release();
	} finally { await store.close(); globalThis.Worker = original; }
});
