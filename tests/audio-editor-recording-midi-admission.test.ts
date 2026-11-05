/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingMidiAdmission } from '../src/common/editor/controller/recording/internal/recording-midi-admission.ts';
import { createRecordingStartRequests } from '../src/common/editor/controller/recording/internal/recording-start-requests.ts';
import { createControllerRecordingState } from '../src/common/editor/controller/recording/recording-state.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

for (const mode of ['ordinary', 'new-track', 'take-cycle'] as const) test(`${mode} permission and context preparation retain the Record invocation's user gesture`, async context => {
	const midi = deferred<void>(); context.after(() => { midi.resolve(); });
	const events: string[] = [];
	const project = { id: 'project', sampleRate: 48_000, tracks: [{ id: 'record', type: 'audio', armed: true }] };
	const stream = { getAudioTracks: () => [] };
	const prepare = createRecordingMidiAdmission({ getProject: () => project,
		pending: { hasPendingEdits: () => true, settled: expected => { assert.strictEqual(expected, project); events.push('midi-fence'); return midi.promise; } },
		getRoutes: () => ({ record: { kind: 'display', channelStart: 0, channelCount: 1 } }),
		getPreferredInput: () => ({ deviceId: 'display', channelCount: 1 }), sampleRate: () => 48_000,
		capturePool: { async acquireDisplay() { events.push('display-permission'); return stream; }, async acquireHardware() { events.push('hardware-permission'); return stream; } },
		engine: { async getAudioContext() { events.push('context'); return { sampleRate: 48_000, currentTime: 0, async resume() { events.push('resume'); } }; } },
		releaseInputs() { events.push('release'); },
	});
	let finished = false;
	const request = prepare({ trackId: 'record' }, { projectId: 'project', generation: 1, assertCurrent() {} }, mode);
	assert.deepEqual(events, ['display-permission', 'context', 'midi-fence'], 'permission entry precedes every await');
	assert.ok(request);
	const completion = Promise.resolve(request).then(value => { finished = true; return value; });
	await settle(); assert.equal(finished, false); assert.ok(events.includes('resume'));
	midi.resolve(); assert.equal((await completion)?.reusePreparedInputsOnly, true);
});

test('an idle Record retains its original synchronous admission and permission owner', () => {
	const prepare = createRecordingMidiAdmission({ getProject: () => ({ id: 'project', tracks: [] }),
		pending: { hasPendingEdits: () => false, async settled() { assert.fail('no MIDI fence needed'); } },
		getRoutes: () => ({}), getPreferredInput: () => ({ deviceId: 'default', channelCount: 2 }), sampleRate: () => 48_000,
		capturePool: { async acquireDisplay() { assert.fail('idle permission remains in existing capture owner'); }, async acquireHardware() { assert.fail('idle permission remains in existing capture owner'); } },
		engine: { async getAudioContext() { assert.fail('idle context remains in existing capture owner'); } }, releaseInputs() {},
	});
	assert.equal(prepare({}, { projectId: 'project', generation: 1, assertCurrent() {} }, 'ordinary'), undefined);
});

test('cycle Record exposes admission while allowing pending MIDI to finish before capture becomes active', async () => {
	const midi = deferred<void>(); let starts = 0;
	const state = Object.assign(createControllerRecordingState({ recordingRouting: { routes: {}, offsets: {} }, recordingInputGain: 1, preferredInputDeviceId: 'default' }),
		{ readOnly: false, disposed: false, projectBinPreview: null });
	const requests = createRecordingStartRequests({ state, getProjectId: () => 'project',
		prepareRecordingStart: async options => { await midi.promise; return { ...options, reusePreparedInputsOnly: true }; },
		beginRecording() {}, async beginTakeCycleRecording(scope) { assert.equal(scope.reusePreparedInputsOnly, true); starts++; return { stop() {} }; },
		async performLegacyFinalization() {}, async performRoutedFinalization() {},
	});
	const starting = requests.startTakeCycleRecording();
	assert.equal(state.recordingAdmissionPending, true); assert.equal(state.recordingStarting, false); assert.equal(starts, 0);
	midi.resolve(); await starting;
	assert.equal(starts, 1); assert.equal(state.recordingAdmissionPending, false); assert.ok(state.recorder);
});

test('canceled MIDI admission rejects before the MIDI write or native permission settles', async () => {
	const midi = deferred<void>(), permission = deferred<{ getAudioTracks(): never[] }>();
	const abort = new AbortController(); let released = 0;
	const prepare = createRecordingMidiAdmission({ getProject: () => ({ id: 'project', tracks: [] }),
		pending: { hasPendingEdits: () => true, settled: () => midi.promise }, getRoutes: () => ({}),
		getPreferredInput: () => ({ deviceId: 'default', channelCount: 2 }), sampleRate: () => 48_000,
		capturePool: { acquireHardware: () => permission.promise, acquireDisplay: () => permission.promise },
		engine: { async getAudioContext() { return { sampleRate: 48_000, currentTime: 0, async resume() {} }; } }, releaseInputs() { released++; },
	});
	const request = prepare({}, { signal: abort.signal, projectId: 'project', generation: 1, assertCurrent() {} }, 'new-track');
	const outcome = Promise.allSettled([request]);
	abort.abort(new DOMException('Stopped', 'AbortError'));
	await settle();
	let finished = false; void outcome.then(() => { finished = true; }); await settle();
	const rejectedBeforeNativeCompletion = finished;
	midi.resolve(); permission.resolve({ getAudioTracks: () => [] });
	const [result] = await outcome;
	assert.equal(rejectedBeforeNativeCompletion, true);
	assert.equal(result?.status, 'rejected');
	assert.equal(released, 0, 'the canceled start owner releases synchronously; late admission completion does not release a newer input');
});

test('a retry stages display permission before waiting for the canceled capture journal to retire', async () => {
	const retiring = deferred<void>(), events: string[] = [];
	const prepare = createRecordingMidiAdmission({ getProject: () => ({ id: 'project', tracks: [] }),
		pending: { hasPendingEdits: () => false, async settled() { assert.fail('ordinary retry does not load MIDI'); } },
		getRoutes: () => ({}), getPreferredInput: () => ({ deviceId: 'display', channelCount: 1 }), sampleRate: () => 48_000,
		capturePool: { async acquireDisplay() { events.push('permission'); return { getAudioTracks: () => [] }; }, async acquireHardware() { assert.fail('display source'); } },
		engine: { async getAudioContext() { events.push('context'); return { sampleRate: 48_000, currentTime: 0, async resume() {} }; } }, releaseInputs() {},
	});
	const request = prepare({}, { projectId: 'project', generation: 3, assertCurrent() {} }, 'new-track', retiring.promise);
	assert.deepEqual(events, ['permission', 'context']);
	let completed = false; const completion = Promise.resolve(request).then(value => { completed = true; return value; });
	await settle(); assert.equal(completed, false);
	retiring.resolve(); assert.equal((await completion)?.reusePreparedInputsOnly, true);
});

test('repeated Stop and retry retain every previous capture cleanup before beginning a fresh transaction', async () => {
	const cleanup = deferred<void>(); let begins = 0, preparations = 0;
	const state = Object.assign(createControllerRecordingState({ recordingRouting: { routes: {}, offsets: {} }, recordingInputGain: 1, preferredInputDeviceId: 'default' }),
		{ readOnly: false, disposed: false, projectBinPreview: null });
	const requests = createRecordingStartRequests({ state, getProjectId: () => 'project',
		prepareRecordingStart(options, _scope, _mode, previous) { if (!previous) return undefined; preparations++; return Promise.resolve(options); },
		async beginRecording(_options, scope) { begins++; if (begins === 1) { state.recordingStarting = true; await cleanup.promise; scope.assertCurrent(); } },
		async performLegacyFinalization() {}, async performRoutedFinalization() {},
	});
	const first = Promise.allSettled([requests.startRecording()]); requests.cancelRecordingStart();
	const second = Promise.allSettled([requests.startRecording()]); requests.cancelRecordingStart();
	const third = Promise.allSettled([requests.startRecording()]); await settle();
	assert.equal(preparations, 2); assert.equal(begins, 1, 'fresh permissions stage, but old recovery cleanup remains authoritative');
	cleanup.resolve(); const [[old], [superseded], [current]] = await Promise.all([first, second, third]);
	assert.equal(old?.status, 'rejected'); assert.equal(superseded?.status, 'rejected'); assert.equal(current?.status, 'fulfilled');
	assert.equal(begins, 2); assert.equal(state.recordingStartPromise, null);
});
