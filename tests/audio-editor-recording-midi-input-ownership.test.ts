/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingCapturePool } from '../src/common/editor/recording-capture-pool.js';
import { createRecordingMidiAdmission } from '../src/common/editor/controller/recording/internal/recording-midi-admission.ts';
import { createMockStream, createMockTrack } from './helpers/audio-editor-recording-controller-harness.js';
import { deferred, settle } from './helpers/async-test-control.ts';

for (const kind of ['device', 'display'] as const) test(`${kind} retry owns its permission grant independently of a canceled MIDI admission`, async context => {
	const midi = deferred<void>();
	const oldAudio = createMockTrack('audio', { channelCount: 2 }), newAudio = createMockTrack('audio', { channelCount: 2 });
	const oldVideo = createMockTrack('video'), newVideo = createMockTrack('video');
	const oldStream = createMockStream(kind === 'display' ? [oldAudio, oldVideo] : [oldAudio]);
	const newStream = createMockStream(kind === 'display' ? [newAudio, newVideo] : [newAudio]);
	const oldPermission = deferred<typeof oldStream>(), newPermission = deferred<typeof newStream>();
	let permissions = 0;
	const request = () => ++permissions === 1 ? oldPermission.promise : newPermission.promise;
	const pool = createRecordingCapturePool({ requestHardwareInput: request, requestDisplayInput: request });
	context.after(() => { midi.resolve(); oldPermission.resolve(oldStream); newPermission.resolve(newStream); pool.dispose(); });
	const prepare = createRecordingMidiAdmission({ getProject: () => ({ id: 'project', tracks: [{ id: 'track', type: 'audio', armed: true }] }),
		pending: { hasPendingEdits: () => true, settled: () => midi.promise },
		getRoutes: () => ({ track: kind === 'display' ? { kind: 'display', channelStart: 0, channelCount: 2 }
			: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 2 } }),
		getPreferredInput: () => ({ deviceId: kind === 'display' ? 'display' : 'default', channelCount: 2 }), sampleRate: () => 48_000,
		capturePool: pool, engine: { async getAudioContext() { return { sampleRate: 48_000, currentTime: 0, async resume() {} }; } },
		releaseInputs() { pool.releaseAll(); },
	});
	const canceled = new AbortController();
	const first = Promise.allSettled([prepare({ trackId: 'track' }, { signal: canceled.signal, projectId: 'project', generation: 1, assertCurrent() {} }, 'ordinary')]);
	await settle(); assert.equal(permissions, 1);
	canceled.abort(new DOMException('Stopped', 'AbortError'));
	pool.releaseAll(); // The recording start owner releases before admitting the next intent.
	const second = Promise.allSettled([prepare({ trackId: 'track' }, { projectId: 'project', generation: 2, assertCurrent() {} }, 'ordinary')]);
	await settle(); const requestsBeforeOldGrant = permissions;
	oldPermission.resolve(oldStream); await settle();
	const oldStopped = oldAudio.readyState === 'ended' && (kind !== 'display' || oldVideo.readyState === 'ended');
	newPermission.resolve(newStream); midi.resolve();
	const [[firstResult], [secondResult]] = await Promise.all([first, second]);
	assert.equal(requestsBeforeOldGrant, 2, 'the retry must not inherit the invalidated permission promise');
	assert.equal(firstResult?.status, 'rejected'); assert.equal(secondResult?.status, 'fulfilled');
	assert.equal(oldStopped, true, 'late canceled grants are stopped');
	assert.equal(newAudio.readyState, 'live', 'late canceled completion must not release the retry input');
	assert.strictEqual(kind === 'display' ? pool.getDisplay() : pool.getHardware('default'), newStream);
});
