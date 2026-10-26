/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';

for (const deviceId of ['headphones', 'native:wasapi:out:headphones']) test(`a settings storage failure preserves the selected listening output ${deviceId}`, async () => {
	let listeningOutput = '';
	const storageError = new DOMException('The settings quota is full.', 'QuotaExceededError');
	const fixture = createFixture({
		setOutputDevice: async id => { listeningOutput = id; return { activeDeviceId: id }; },
		persistSetting: async () => { throw storageError; },
	});
	fixture.state.audioOutputDevices = [{ deviceId }];
	await assert.rejects(fixture.service.setAudioOutputDevice(deviceId), error => error === storageError);
	assert.equal(fixture.state.preferredOutputDeviceId, deviceId,
		'the selector must continue to name the output already adopted for this session');
	if (deviceId === 'headphones') {
		assert.equal(listeningOutput, deviceId);
		assert.equal(fixture.state.activeOutputDeviceId, deviceId);
		assert.equal(fixture.state.audioOutputStatus, 'active');
	}
	assert.equal(fixture.publishes(), 1, 'the adopted selection remains visible even when persisting it fails');
});
