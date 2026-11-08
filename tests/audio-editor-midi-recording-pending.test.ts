/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { midiRecordingPendingFixture } from './helpers/midi-recording-pending-fixture.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';

for (const mode of ['ordinary', 'new-track', 'sound-activated', 'timed'] as const) test(`${mode} Record includes the MIDI note edit requested before its capture snapshot`, async context => {
	const f = await midiRecordingPendingFixture(context);
	f.holdWrites();
	const editing = f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 67 });
	const editOutcome = Promise.allSettled([editing]); await f.entered.promise;
	const starting = mode === 'new-track' ? f.controller.actions.recording.startNewTrack()
		: mode === 'sound-activated' ? f.controller.actions.recording.startSoundActivated({ trackId: f.recordingTrackId })
			: mode === 'timed' ? f.controller.actions.recording.schedule(Date.now() + 60_000, { trackId: f.recordingTrackId })
				: f.controller.actions.recording.start({ trackId: f.recordingTrackId });
	const startOutcome = Promise.allSettled([starting]);
	await settle();
	const createdWhilePending = f.created.length, tracksWhilePending = f.controller.project?.tracks.length;
	f.release.resolve();
	const [[edit], [start]] = await Promise.all([editOutcome, startOutcome]);
	if (mode === 'timed') f.controller.actions.recording.cancelScheduled();
	assert.equal(edit?.status, 'fulfilled'); assert.equal(start?.status, 'fulfilled');
	assert.equal(createdWhilePending, 0, 'capture waits before constructing a recorder or adopting an old project snapshot');
	assert.equal(readMidiClip(f.controller.project?.clips.find(clip => clip.id === f.clipId))?.notes[0]?.pitch, 67);
	assert.equal(mode === 'timed' ? f.loadedPitch : f.admittedPitch, 67);
	if (mode === 'new-track') assert.equal(tracksWhilePending, 2, 'an earlier MIDI edit settles before adding the recording destination');
});


for (const stop of ['recording', 'transport'] as const) test(`${stop} Stop cancels a pending Record admission while allowing the earlier MIDI edit to finish`, async context => {
	const f = await midiRecordingPendingFixture(context); f.holdWrites();
	const editing = f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 67 });
	const editOutcome = Promise.allSettled([editing]); await f.entered.promise;
	const starting = f.controller.actions.recording.start({ trackId: f.recordingTrackId });
	const startOutcome = Promise.allSettled([starting]);
	await waitFor(() => f.controller.getSnapshot().recordingStarting, 'pending Record visible as Starting');
	assert.equal(f.created.length, 0);
	await f.controller.actions[stop].stop();
	assert.equal(f.controller.getSnapshot().recordingStarting, false);
	f.release.resolve();
	const [[edit], [start]] = await Promise.all([editOutcome, startOutcome]);
	assert.equal(edit?.status, 'fulfilled'); assert.equal(start?.status, 'rejected');
	if (start?.status === 'rejected') assert.equal(start.reason instanceof DOMException && start.reason.name, 'AbortError');
	assert.equal(f.created.length, 0); assert.equal(f.controller.getSnapshot().recording, false);
	assert.equal(readMidiClip(f.controller.project?.clips.find(clip => clip.id === f.clipId))?.notes[0]?.pitch, 67);
});

test('Stop allows a fresh Record intent while the prior MIDI publication remains pending', async context => {
	const f = await midiRecordingPendingFixture(context); f.holdWrites();
	const editing = f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 67 });
	const editOutcome = Promise.allSettled([editing]); await f.entered.promise;
	const first = f.controller.actions.recording.start({ trackId: f.recordingTrackId });
	const firstOutcome = Promise.allSettled([first]);
	await waitFor(() => f.controller.getSnapshot().recordingStarting, 'first Record admission');
	await f.controller.actions.recording.stop();
	const retry = f.controller.actions.recording.start({ trackId: f.recordingTrackId });
	const retryOutcome = Promise.allSettled([retry]);
	await settle();
	const retryStarting = f.controller.getSnapshot().recordingStarting;
	f.release.resolve();
	const [[edit], [canceled], [started]] = await Promise.all([editOutcome, firstOutcome, retryOutcome]);
	assert.equal(retryStarting, true, 'the retry owns a new visible admission before the MIDI write settles');
	assert.equal(edit?.status, 'fulfilled'); assert.equal(canceled?.status, 'rejected'); assert.equal(started?.status, 'fulfilled');
	assert.equal(f.created.length, 1); assert.equal(f.admittedPitch, 67);
});

for (const change of ['selection', 'authored'] as const) test(`Record preserves ${change} document authority after MIDI publication while native permission is pending`, async context => {
	const permission = deferred<void>(); context.after(() => { permission.resolve(); });
	const f = await midiRecordingPendingFixture(context, { configurePool(pool) {
		return { ...pool, async acquireHardware(...args: Parameters<typeof pool.acquireHardware>) {
			await permission.promise; return pool.acquireHardware(...args);
		} };
	} });
	f.holdWrites();
	const editing = f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 67 });
	await f.entered.promise;
	const starting = f.controller.actions.recording.start({ trackId: f.recordingTrackId });
	const startOutcome = Promise.allSettled([starting]);
	f.release.resolve(); await editing; await settle();
	assert.equal(f.created.length, 0); assert.equal(f.controller.getSnapshot().recordingStarting, true);
	if (change === 'selection') f.controller.actions.timeline.selectClip(f.clipId);
	else f.controller.actions.track.update(f.recordingTrackId, { name: 'Edited during the input permission request' });
	permission.resolve(); const [result] = await startOutcome;
	assert.equal(result?.status, change === 'selection' ? 'fulfilled' : 'rejected');
	assert.equal(f.created.length, change === 'selection' ? 1 : 0);
	assert.equal(readMidiClip(f.controller.project?.clips.find(clip => clip.id === f.clipId))?.notes[0]?.pitch, 67);
});

test('canceling Timer Record cancels MIDI admission before the prior source publication completes', async context => {
	const f = await midiRecordingPendingFixture(context); f.holdWrites();
	const editing = f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 67 });
	const editOutcome = Promise.allSettled([editing]); await f.entered.promise;
	const starting = f.controller.actions.recording.schedule(Date.now() + 60_000, { trackId: f.recordingTrackId });
	const startOutcome = Promise.allSettled([starting]);
	await waitFor(() => f.controller.getSnapshot().recordingStarting, 'Timer Record waiting for prior MIDI');
	f.controller.actions.recording.cancelScheduled();
	const startingAfterCancel = f.controller.getSnapshot().recordingStarting;
	f.release.resolve(); const [[edit], [result]] = await Promise.all([editOutcome, startOutcome]);
	assert.equal(startingAfterCancel, false, 'canceling Timer Record clears the same admission owner immediately');
	assert.equal(edit?.status, 'fulfilled'); assert.equal(result?.status, 'fulfilled'); assert.equal(f.created.length, 0);
});

test('pending Record admission owns public play and seek until its earlier MIDI edit publishes', async context => {
	const f = await midiRecordingPendingFixture(context); f.holdWrites();
	const editing = f.controller.actions.midi.updateNote(f.clipId, 'note', { pitch: 67 });
	await f.entered.promise;
	const starting = f.controller.actions.recording.start({ trackId: f.recordingTrackId });
	await waitFor(() => f.controller.getSnapshot().recordingStarting, 'Record admission');
	await f.controller.actions.transport.playPause();
	await f.controller.actions.transport.playAtSpeed(1.25);
	f.controller.actions.transport.seek(4000);
	const playsWhilePending = f.playCalls, positionWhilePending = f.positionFrame;
	f.release.resolve(); await Promise.all([editing, starting]);
	assert.equal(playsWhilePending, 0); assert.equal(positionWhilePending, 0);
	assert.equal(f.admittedPitch, 67);
});
