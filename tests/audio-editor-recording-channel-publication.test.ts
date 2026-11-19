/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';

test('a recording channel choice publishes coherent radio and route state before required persistence settles', async () => {
	const routingWrite = deferred<unknown>();
	const snapshots: Array<{ preference: number; route: number | undefined }> = [];
	const fixture = createFixture({
		persistSetting: (key) => key === 'routing:project' ? routingWrite.promise : Promise.resolve(),
		publishDocumentSnapshot: (state) => snapshots.push({
			preference: state.preferredInputChannelCount,
			route: state.recordingRouting.routes.track?.channelCount,
		}),
	});
	fixture.state.preferredInputDeviceId = 'display';
	fixture.state.recordingRouting = { routes: {
		track: { kind: 'display', channelStart: 0, channelCount: 1, followsPreferences: true },
	}, offsets: {} };
	let settled = false;
	const selection = fixture.service.setPreferredInputChannelCount(2).finally(() => { settled = true; });
	try {
		assert.deepEqual([...snapshots], [{ preference: 2, route: 2 }]);
		assert.equal(settled, false, 'the required routing write must still be awaited');
		assert.deepEqual(fixture.persistCalls.map(([key, , options]) => [key, options]), [
			['routing:project', { policy: 'required' }],
		]);
	} finally {
		routingWrite.resolve(undefined);
		await selection;
	}
	assert.equal(settled, true);
	assert.ok(fixture.persistCalls.some(([key, value]) => key === 'audio-devices'
		&& (value as { inputChannelCount?: number }).inputChannelCount === 2));
});

test('a rejected required route write remains an error and cannot roll back a newer channel choice', async () => {
	const firstWrite = deferred<unknown>();
	const failure = new Error('Routing storage failed.');
	const snapshots: number[] = [];
	let routingWrites = 0;
	const fixture = createFixture({
		persistSetting: (key) => key === 'routing:project' && routingWrites++ === 0
			? firstWrite.promise : Promise.resolve(),
		publishDocumentSnapshot: (state) => {
			assert.equal(state.recordingRouting.routes.track?.channelCount, state.preferredInputChannelCount);
			snapshots.push(state.preferredInputChannelCount);
		},
	});
	fixture.state.recordingRouting = { routes: {
		track: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1, followsPreferences: true },
	}, offsets: {} };
	const first = fixture.service.setPreferredInputChannelCount(2);
	const rejected = assert.rejects(first, (error) => error === failure);
	try {
		assert.equal(await fixture.service.setPreferredInputChannelCount(1), 1);
		assert.deepEqual([...snapshots], [2, 1]);
	} finally {
		firstWrite.reject(failure);
		await rejected;
	}
	assert.equal(fixture.state.preferredInputChannelCount, 1);
	assert.equal(fixture.state.recordingRouting.routes.track?.channelCount, 1);
	assert.deepEqual(snapshots, [2, 1]);
	assert.ok(fixture.persistCalls.filter(([key]) => key === 'audio-devices')
		.every(([, value]) => (value as { inputChannelCount?: number }).inputChannelCount === 1));
});

test('channel selection preserves a device-preference persistence failure', async () => {
	const failure = new Error('Device preferences could not be stored.');
	const fixture = createFixture({ persistSetting: async (key) => {
		if (key === 'audio-devices') throw failure;
	} });
	await assert.rejects(fixture.service.setPreferredInputChannelCount(2), (error) => error === failure);
	assert.equal(fixture.state.preferredInputChannelCount, 2);
});

test('a snapshot publication failure still awaits the already required routing write', async () => {
	const routingWrite = deferred<unknown>();
	const failure = new Error('Snapshot listener failed.');
	const fixture = createFixture({
		persistSetting: (key) => key === 'routing:project' ? routingWrite.promise : Promise.resolve(),
		publishDocumentSnapshot: () => { throw failure; },
	});
	fixture.state.recordingRouting = { routes: {
		track: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1, followsPreferences: true },
	}, offsets: {} };
	let settled = false;
	const result = fixture.service.setPreferredInputChannelCount(2).finally(() => { settled = true; });
	const rejected = assert.rejects(result, (error) => error === failure);
	try {
		await Promise.resolve();
		assert.equal(settled, false);
	} finally {
		routingWrite.resolve(undefined);
		await rejected;
	}
	assert.equal(fixture.persistCalls.some(([key]) => key === 'audio-devices'), false);
});

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}
