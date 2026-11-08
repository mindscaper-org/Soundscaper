/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RecordingInputSelectors from '../src/common/editor/ui/RecordingInputSelectors.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { TRACK_COPY_BY_LOCALE } from '../src/common/i18n/track-copy.js';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';

test('selecting a native input preserves its physical channel menu after a mono lease opens', async () => {
	const fixture = createFixture();
	await fixture.service.setHostInventory('wasapi', { backend: 'wasapi', status: 'available', detail: '', devices: [{
		handle: 'interface', label: 'Four physical inputs', direction: 'input', channelCount: 4, isDefault: true,
	}] });
	const deviceId = 'native:wasapi:in:interface';
	fixture.state.recordingRouting = { routes: { track: { kind: 'device', deviceId, channelStart: 0, channelCount: 1 } }, offsets: {} };
	assert.match(channelMenu(fixture), /<option value="2">Mono 3<\/option>/u);
	fixture.setPoolSources([{ key: `device:${deviceId}`, kind: 'device', deviceId, channelCount: 1 }]);
	fixture.service.syncRecordingPoolSnapshot(); fixture.service.updateRecordingDeviceRows();
	assert.equal(fixture.state.recordingDevices[0]?.channels?.length, 4, 'the native report retains the physical map');
	assert.match(channelMenu(fixture), /<option value="2">Mono 3<\/option>/u,
		'opening the first input must not hide the physical third input from its existing channel menu');
	assert.equal(fixture.state.recordingDevices[0]?.channelCount, 4);
	assert.equal(fixture.state.recordingPoolSources[0]?.channelCount, 1, 'the actual capture lease remains mono');
});

test('ordinary browser devices still narrow their channel menu to the actual captured width', () => {
	const fixture = createFixture();
	fixture.state.recordingDevices = [{ deviceId: 'usb', label: 'Browser input', channelCount: 4 }];
	fixture.state.recordingRouting = { routes: { track: { kind: 'device', deviceId: 'usb', channelStart: 0, channelCount: 1 } }, offsets: {} };
	assert.match(channelMenu(fixture), /<option value="2">Mono 3<\/option>/u);
	fixture.setPoolSources([{ key: 'device:usb', kind: 'device', deviceId: 'usb', channelCount: 1 }]);
	fixture.service.syncRecordingPoolSnapshot(); fixture.service.updateRecordingDeviceRows();
	assert.equal(fixture.state.recordingDevices[0]?.channelCount, 1);
	assert.doesNotMatch(channelMenu(fixture), /Mono 3/u);
});

function channelMenu(fixture: ReturnType<typeof createFixture>): string {
	return renderToStaticMarkup(<RecordingInputSelectors controller={{ actions: { recording: { setTrackInput() {} } } }}
		recordingInputs={{ routes: fixture.state.recordingRouting.routes, devices: fixture.state.recordingDevices,
			health: fixture.state.recordingRouteHealth, sources: fixture.state.recordingPoolSources }}
		track={{ id: 'track', name: 'Microphone', type: 'audio' }} displayAudioSupported={false}
		copy={{ ...ENGLISH_COPY, ...TRACK_COPY_BY_LOCALE.en }} run={(operation: () => unknown) => operation()} />);
}
