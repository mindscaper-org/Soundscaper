/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';

test('Mono/Stereo preferences retarget an already enabled input meter with their automatic route', async () => {
	const f = createFixture();
	f.state.microphoneMetering = true;
	f.state.recordingRouting = { routes: { track: { kind: 'device', deviceId: 'default',
		channelStart: 0, channelCount: 1, followsPreferences: true } }, offsets: {} };
	await f.service.setPreferredInputChannelCount(2);
	assert.equal(f.state.recordingRouting.routes.track?.channelCount, 2);
	assert.equal(f.meterSynchronizations(), 1, 'the live analyser must adopt the new stereo route');
});

test('changing the preferred input retargets the existing meter instead of continuing to show the old device', async () => {
	const f = createFixture();
	f.state.microphoneMetering = true;
	f.state.audioInputDevices = [{ deviceId: 'usb', label: 'USB input' }];
	f.state.recordingRouting = { routes: { track: { kind: 'device', deviceId: 'default',
		channelStart: 0, channelCount: 1, followsPreferences: true } }, offsets: {} };
	await f.service.setPreferredInputDevice('usb');
	assert.equal(f.state.recordingRouting.routes.track?.kind, 'device');
	assert.equal(f.meterSynchronizations(), 1, 'the meter must follow the newly chosen device');
});
