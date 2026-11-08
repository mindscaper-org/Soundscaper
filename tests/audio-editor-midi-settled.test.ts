/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

test('MIDI settled waits until a queued note edit publishes its complete fallback and document', async () => {
	const fixture = midiServiceFixture();
	const { clipId } = await fixture.service.addTrack();
	await fixture.service.addNote(clipId, { id: 'note', pitch: 60, startFrame: 0, durationFrames: 2000, velocity: 100, channel: 0 });
	let release!: () => void;
	let entered!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const writing = new Promise<void>(resolve => { entered = resolve; });
	const begin = fixture.dependencies.store.beginSourceWrite;
	const service = createMidiService({ ...fixture.dependencies, store: { ...fixture.dependencies.store, beginSourceWrite: async (id, metadata) => {
		const writer = await begin(id, metadata);
		return { ...writer, async write(channels) { entered(); await gate; await writer.write(channels); } };
	} } });
	const editing = service.updateNote(clipId, 'note', { pitch: 67 });
	await writing;
	let finished = false;
	const settling = service.settled().then(() => { finished = true; });
	await Promise.resolve();
	assert.equal(finished, false);
	release();
	await Promise.all([editing, settling]);
	assert.equal(readMidiClip(fixture.project().clips[0])?.notes[0]?.pitch, 67);
});
