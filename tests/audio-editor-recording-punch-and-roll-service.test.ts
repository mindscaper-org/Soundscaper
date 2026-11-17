/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingPunchAndRollService } from '../src/common/editor/controller/recording/internal/recording-punch-and-roll-service.ts';
import { createControllerRecordingState } from '../src/common/editor/controller/recording/recording-state.ts';
import type { RecordingStartOptions } from '../src/common/editor/controller/recording/internal/recording-session-service.ts';

function fixture() {
	const state = { ...createControllerRecordingState({ recordingRouting: { routes: {}, offsets: {} },
		recordingInputGain: 1, preferredInputDeviceId: 'default' }), readOnly: false, disposed: false };
	let projectId = 'project';
	let generation = 0;
	const events: unknown[] = [];
	let finishStop: (() => void) | null = null;
	const service = createRecordingPunchAndRollService({
		state,
		getProject: () => ({ id: projectId, tracks: [{ id: 'voice', type: 'audio' }, { id: 'backup', type: 'audio' }] }),
		captureCurrent: () => generation,
		assertCurrent: (token: number) => { if (token !== generation) throw new DOMException('changed', 'AbortError'); },
		stopRecording: async () => { events.push('stop'); await new Promise<void>(resolve => { finishStop = resolve; }); state.recorder = null; },
		startRecording: async (options: RecordingStartOptions) => { events.push(options); },
		pauseTransport: () => { events.push('pause'); },
		seek: (frame: number) => { events.push(frame); },
		persistDuration: async (seconds: number) => { events.push(['persist', seconds]); },
		publish: () => {},
	});
	return { service, state, events, finish: () => { assert.ok(finishStop); finishStop(); },
		switchProject: () => { projectId = 'other'; generation++; } };
}

test('Punch Again finishes once before restarting the same range and tracks', async () => {
	const f = fixture();
	f.service.rememberPunch(144_000, { startFrame: 144_000, endFrame: 240_000 }, ['voice']);
	const first = f.service.punchAgain();
	const second = f.service.punchAgain();
	assert.strictEqual(first, second);
	assert.deepEqual(f.events, ['stop']);
	f.finish();
	assert.equal(await first, true);
	assert.deepEqual(f.events, ['stop', 'pause', 144_000, {
		trackId: 'voice', punch: { startFrame: 144_000,
			selection: { startFrame: 144_000, endFrame: 240_000 }, trackIds: ['voice'] },
	}]);
});

test('Punch Again ignores missing targets and cannot restart into a switched project', async () => {
	const f = fixture();
	assert.equal(await f.service.punchAgain(), false);
	f.service.rememberPunch(48_000, null, ['deleted']);
	assert.equal(await f.service.punchAgain(), false);
	assert.deepEqual(f.events, []);
	f.service.rememberPunch(48_000, null, ['voice']);
	const pending = f.service.punchAgain();
	f.switchProject();
	f.finish();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(f.events, ['stop']);
});

test('lead-in duration persists without enabling recording and stays fixed during capture', async () => {
	const f = fixture();
	assert.equal(await f.service.setLeadInDurationSeconds(3.25), true);
	assert.equal(f.state.leadInDurationSeconds, 3.25);
	assert.equal(f.state.leadInRecording, false);
	assert.deepEqual(f.events, [['persist', 3.25]]);
	for (const value of [-1, NaN, Infinity]) {
		await assert.rejects(f.service.setLeadInDurationSeconds(value), { name: 'RangeError' });
	}
	f.state.recorder = { stop: async () => {} };
	assert.equal(await f.service.setLeadInDurationSeconds(5), false);
	assert.equal(f.state.leadInDurationSeconds, 3.25);
});


test('Stop cancels a retry while the preceding take is still finalizing', async () => {
	const f = fixture();
	f.service.rememberPunch(48_000, null, ['voice']);
	const pending = f.service.punchAgain();
	f.service.cancelPendingRetry();
	f.finish();
	assert.equal(await pending, false);
	assert.deepEqual(f.events, ['stop']);
});


test('a multi-track retry explicitly retains every target even when none are armed', async () => {
	const f = fixture();
	f.service.rememberPunch(48_000, null, ['voice', 'backup']);
	const pending = f.service.punchAgain();
	f.finish();
	assert.equal(await pending, true);
	assert.deepEqual(f.events.at(-1), { multitrack: true,
		punch: { startFrame: 48_000, selection: null, trackIds: ['voice', 'backup'] } });
});

test('cancelling capture after a project switch retires the remembered punch', async () => {
	const f = fixture();
	f.service.rememberPunch(48_000, null, ['voice']);
	f.switchProject();
	f.service.cancelPendingRetry();
	assert.equal(f.state.lastRecordingPunch, null);
	assert.equal(await f.service.punchAgain(), false);
	assert.deepEqual(f.events, []);
});
