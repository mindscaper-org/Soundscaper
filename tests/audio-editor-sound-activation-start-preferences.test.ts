/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { soundActivationStartFixture } from './helpers/sound-activation-start-fixture.ts';
import { remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

for (const routed of [false, true]) {
	test(`sound-activated Record uses the committed threshold (routed=${routed})`, async t => {
		const f = await soundActivationStartFixture(t, routed);
		await f.actions.setThresholdDb(-40);
		await f.controller.actions.recording.startSoundActivated({ trackId: f.trackId });
		assert.equal(await f.capture(), 1);
	});

	test(`Record stages input but waits for the requested threshold (routed=${routed})`, async t => {
		const f = await soundActivationStartFixture(t, routed); f.holdPreferences();
		const change = f.actions.setThresholdDb(-40); await f.entered.promise;
		const start = Promise.resolve(f.controller.actions.recording.startSoundActivated({ trackId: f.trackId }));
		await waitFor(() => f.inputRequests > 0 && f.resumes > 0, 'input and context staged during persistence');
		await settle();
		assert.equal(f.created.length, 0, 'a take must not freeze the superseded threshold');
		assert.equal(await remainsPending(start), true);
		f.allowPreferences(); await change; await start;
		assert.equal(f.controller.getSnapshot().recordingInputs.soundActivation.sources[0]?.settings.thresholdDb, -40);
		assert.equal(await f.capture(), 1);
	});
}

test('toolbar Stop cancels the threshold wait and immediate Record retry owns the new take', async t => {
	const f = await soundActivationStartFixture(t); f.holdPreferences();
	const change = f.actions.setThresholdDb(-40); await f.entered.promise;
	const first = f.controller.actions.recording.startSoundActivated({ trackId: f.trackId });
	await waitFor(() => f.resumes > 0, 'first input staging');
	await f.controller.actions.transport.stop(); await first;
	assert.equal(f.created.length, 0);
	const second = f.controller.actions.recording.startSoundActivated({ trackId: f.trackId });
	await settle(); assert.equal(f.created.length, 0);
	assert.equal(await remainsPending(change), true, 'Stop does not cancel the independent preference write');
	f.allowPreferences(); await change; await second;
	assert.equal(f.created.length, 1); assert.equal(await f.capture(), 1);
});

test('a failed pending threshold cancels admission; a later Record uses the rolled-back setting', async t => {
	const f = await soundActivationStartFixture(t); f.holdPreferences(new Error('preferences unavailable'));
	const change = f.actions.setThresholdDb(-40);
	const failedChange = assert.rejects(change, /preferences unavailable/u); await f.entered.promise;
	const start = Promise.resolve(f.controller.actions.recording.startSoundActivated({ trackId: f.trackId }));
	const failedStart = assert.rejects(start, /preferences unavailable/u);
	await waitFor(() => f.resumes > 0, 'input staged before preference failure');
	f.release.resolve(); await failedChange; await failedStart;
	assert.equal(f.created.length, 0);
	assert.equal(f.controller.getSnapshot().recordingInputs.soundActivation.preferences.thresholdDb, -10);
	f.allowPreferences();
	await f.controller.actions.recording.startSoundActivated({ trackId: f.trackId });
	assert.equal(await f.capture(), 0, 'quiet input remains below the old, truthfully retained threshold');
});
