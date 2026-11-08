/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiServiceFixture } from './helpers/midi-service-fixture.ts';
import { createMidiService } from '../src/common/editor/controller/track-audio/midi-service.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

for (const change of ['owned', 'selection', 'authored'] as const) test(`a fenced MIDI barrier follows ${change} document changes by their owner`, async context => {
	const f = midiServiceFixture(); const { clipId, trackId } = await f.service.addTrack();
	await f.service.addNote(clipId, { id: 'note', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 2000 });
	const entered = deferred<void>(), release = deferred<void>(); context.after(() => { release.resolve(); });
	const begin = f.dependencies.store.beginSourceWrite;
	const service = createMidiService({ ...f.dependencies, store: { ...f.dependencies.store, async beginSourceWrite(id, metadata) {
		const writer = await begin(id, metadata); return { ...writer, async write(channels) { entered.resolve(); await release.promise; await writer.write(channels); } };
	} } });
	const editing = service.updateNote(clipId, 'note', { pitch: 67 });
	const editResult = Promise.allSettled([editing]); await entered.promise;
	const expected = f.project();
	const settling = service.settled(expected);
	const settledResult = Promise.allSettled([settling]);
	assert.equal(service.hasPendingEdits(), true);
	if (change === 'selection') {
		f.apply({ type: 'selection/set', startFrame: 100, endFrame: 200, trackIds: [trackId], clipIds: [] });
		service.followSelection(expected, f.project());
	} else if (change === 'authored') f.apply({ type: 'track/update', trackId, changes: { name: 'Changed by another authoring action' } });
	release.resolve();
	const [[edit], [settled]] = await Promise.all([editResult, settledResult]);
	assert.equal(edit?.status, change === 'authored' ? 'rejected' : 'fulfilled');
	assert.equal(settled?.status, change === 'authored' ? 'rejected' : 'fulfilled');
	if (settled?.status === 'rejected') assert.equal(settled.reason instanceof DOMException && settled.reason.name, 'AbortError');
	assert.equal(service.hasPendingEdits(), false, 'a read waiter never becomes a pending edit');
});

for (const change of ['selection', 'authored'] as const) test(`a recording fence retains ${change} authority while native permission remains pending`, async () => {
	const f = midiServiceFixture(); const { clipId, trackId } = await f.service.addTrack();
	await f.service.addNote(clipId, { id: 'note', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 2000 });
	const expected = f.project(), permission = deferred<void>();
	const editing = f.service.updateNote(clipId, 'note', { pitch: 67 });
	const fence = f.service.settled(expected, permission.promise);
	let fenceFinished = false;
	const outcome = Promise.allSettled([fence]).then(value => { fenceFinished = true; return value; });
	await editing; await settle();
	const beforeChange = f.project();
	if (change === 'selection') {
		f.apply({ type: 'selection/set', startFrame: 100, endFrame: 200, trackIds: [trackId], clipIds: [] });
		f.service.followSelection(beforeChange, f.project());
	} else f.apply({ type: 'track/update', trackId, changes: { name: 'Edited while permission was open' } });
	const finishedBeforePermission = fenceFinished;
	permission.resolve();
	const [result] = await outcome;
	assert.equal(finishedBeforePermission, false, 'Record still owns a document fence while its native prompt is unresolved');
	assert.equal(result?.status, change === 'selection' ? 'fulfilled' : 'rejected');
	assert.equal(f.service.hasPendingEdits(), false);
});
