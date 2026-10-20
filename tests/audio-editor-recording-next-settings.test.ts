/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyRecordingCaptureService } from '../src/common/editor/controller/recording/internal/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from '../src/common/editor/controller/recording/internal/routed-recording-capture-service.ts';
import { preferredRecordingRoutes } from '../src/common/editor/controller/recording/internal/preferred-recording-routes.ts';
import { normalizeRecordingRouting } from '../src/common/editor/recording-routing.js';
import { requestHardwareInput } from '../src/common/editor/recording.js';
import { createRecordingCaptureFixture, createScope } from './fixtures/recording-capture-fixture.ts';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';
import { createFixture as createBootstrapFixture } from './helpers/audio-editor-project-bootstrap-fixture.ts';

test('automatic channel assignments follow the next recording settings across persistence', async () => {
	const fixture = createFixture();
	fixture.state.recordingRouting = normalizeRecordingRouting({ routes: {
		track: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1, followsPreferences: true },
	} }, [{ id: 'track', type: 'audio' }]);
	await fixture.service.setPreferredInputChannelCount(2);
	assert.equal(fixture.state.recordingRouting.routes.track.channelCount, 2);
	const saved = JSON.parse(JSON.stringify(fixture.state.recordingRouting)) as Parameters<typeof normalizeRecordingRouting>[0];
	const roundTrip = normalizeRecordingRouting(saved, [{ id: 'track', type: 'audio' }]);
	assert.equal(roundTrip.routes.track.followsPreferences, true);
	assert.equal(preferredRecordingRoutes(roundTrip, { deviceId: 'native:wasapi:in:mic', channelCount: 1 })
		.routes.track.kind, 'device');
	const legacy = normalizeRecordingRouting({ routes: {
		track: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 },
	} }, [{ id: 'track', type: 'audio' }]);
	assert.equal(preferredRecordingRoutes(legacy, { deviceId: 'different', channelCount: 2 }), legacy);
});

test('the next mono or stereo take uses the requested width on the same automatic route', async () => {
	for (const channelCount of [1, 2]) {
		const fixture = createRecordingCaptureFixture();
		fixture.state.recordingRouting = preferredRecordingRoutes(normalizeRecordingRouting({ routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1, followsPreferences: true },
		} }, [{ id: 'track-1', type: 'audio' }]), { deviceId: 'mic', channelCount });
		await createRoutedRecordingCaptureService(fixture.runtime).capture({ trackId: 'track-1' }, createScope(() => true));
		assert.equal(fixture.state.recordingEntries?.[0]?.route.channelCount, channelCount);
	}
});

test('ordinary and routed input acquisition use the selected native capture rate', async () => {
	for (const kind of ['ordinary', 'routed']) {
		const fixture = createRecordingCaptureFixture();
		fixture.state.recordingRouting = { routes: {
			'track-1': { kind: 'device', deviceId: 'mic', channelStart: 0, channelCount: 1 },
		}, offsets: {} };
		const requestedRates: number[] = [];
		const metadata: Array<Readonly<Record<string, unknown>>> = [];
		const runtime = { ...fixture.runtime,
			recordingInputSampleRate: () => 96_000,
			capturePool: { ...fixture.runtime.capturePool, acquireHardware: async (_deviceId: string, options: { sampleRate: number }) => {
				requestedRates.push(options.sampleRate);
				return fixture.stream;
			} },
			engine: { ...fixture.runtime.engine, getAudioContext: async () => ({
				sampleRate: 96_000, currentTime: 4, async resume() {},
			}) },
			openSourceWriter: async (id: string, record: Readonly<Record<string, unknown>>) => {
				metadata.push(record);
				return fixture.runtime.openSourceWriter(id, record);
			},
		};
		if (kind === 'ordinary') await createLegacyRecordingCaptureService(runtime).capture({ trackId: 'track-1' }, createScope(() => true));
		else await createRoutedRecordingCaptureService(runtime).capture({ trackId: 'track-1' }, createScope(() => true));
		assert.deepEqual(requestedRates, [96_000]);
		assert.equal(metadata[0]?.sampleRate, 96_000);
	}
});

test('an unconnected native input cannot fall back to an Electron microphone', async () => {
	let browserRequests = 0;
	await assert.rejects(() => requestHardwareInput({ deviceId: 'native:asio:in:unconnected',
		mediaDevices: { getUserMedia: async () => { browserRequests += 1; return {} as MediaStream; } },
	}), /native audio input/iu);
	assert.equal(browserRequests, 0);
});


test('desktop bootstrap grants Electron microphone access automatically and preserves native host restoration', async () => {
	for (const host of ['browser', 'wasapi']) {
		const fixture = createBootstrapFixture({ desktopAudio: true });
		fixture.settings.set('product:audio-devices', { host, recordingSampleRate: 96_000 });
		await fixture.service.bootstrap(fixture.lifetime.capture());
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(fixture.state.audioHost, host === 'browser' ? 'electron' : host);
		assert.equal(fixture.state.preferredRecordingSampleRate, 96_000);
		assert.equal(fixture.events.includes('request-input-access'), host === 'browser');
	}
});

test('native input selection publishes its preference without probing the previous hardware session', async () => {
	const fixture = createFixture();
	fixture.state.audioHost = 'wasapi';
	fixture.state.audioInputDevices = [{ deviceId: 'native:wasapi:in:new', label: 'New input' }];
	await fixture.service.setPreferredInputDevice('native:wasapi:in:new');
	assert.equal(fixture.state.preferredInputDeviceId, 'native:wasapi:in:new');
	assert.deepEqual(fixture.hardwareRequests, []);
	assert.equal(fixture.publishes(), 1);
	fixture.state.recorder = {};
	await assert.rejects(() => fixture.service.setRecordingSampleRate(96_000), /recording is active/u);
});


test('choosing recording settings adopts an ordinary legacy route and preserves other channel assignments', async () => {
	const fixture = createFixture();
	fixture.state.recordingRouting = { routes: {
		track: { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 },
		other: { kind: 'device', deviceId: 'default', channelStart: 2, channelCount: 1 },
	}, offsets: {} };
	await fixture.service.setPreferredInputChannelCount(2);
	assert.equal(fixture.state.recordingRouting.routes.track.channelCount, 2);
	assert.equal(fixture.state.recordingRouting.routes.track.followsPreferences, true);
	assert.equal(fixture.state.recordingRouting.routes.other.channelStart, 2);
	await fixture.service.setHostInventory('wasapi', {
		backend: 'wasapi', status: 'available', detail: '', devices: [{
			handle: 'mic', label: 'Native microphone', direction: 'input', channelCount: 2, isDefault: true,
		}],
	});
	assert.equal(fixture.state.recordingRouting.routes.track.kind === 'device'
		? fixture.state.recordingRouting.routes.track.deviceId : '', 'native:wasapi:in:mic');
	assert.equal(fixture.state.recordingRouting.routes.other.kind === 'device'
		? fixture.state.recordingRouting.routes.other.deviceId : '', 'default');
});


test('native sample rate preferences remain unchanged when the engine rejects reconfiguration', async () => {
	const failure = new Error('Remove native plug-in effects before changing the audio sample rate.');
	const fixture = createFixture({ getAudioContext: async () => { throw failure; } });
	fixture.state.audioHost = 'wasapi';
	await assert.rejects(() => fixture.service.setRecordingSampleRate(96_000), error => error === failure);
	assert.equal(fixture.state.preferredRecordingSampleRate, 48_000);
	assert.deepEqual(fixture.persistCalls, []);
	assert.equal(fixture.publishes(), 0);
});
