/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';
import { AudioDevicesFlyout } from '../src/common/editor/ui/toolbar/AudioDevicesFlyout.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperAudioHostRuntime, type SoundscaperAudioHostController } from '../src/common/editor/ui/soundscaper-audio-host-runtime.ts';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';

const uiController = { actions: { audioDevices: {}, recording: {} } };
test('privacy-redacted device names remain empty in the domain and receive translated fallback labels in Audio setup', async () => {
	const fixture = createFixture({ enumerateDevices: async () => [
		{ kind: 'audioinput', deviceId: 'private-input', label: '' }, { kind: 'audiooutput', deviceId: 'private-output', label: '' },
		{ kind: 'audioinput', deviceId: 'named', label: 'Authored $& {number}' },
	] });
	await fixture.service.refreshAudioDevices({ probe: false });
	assert.equal(fixture.state.recordingDevices.find(device => device.deviceId === 'private-input')?.label, '');
	assert.equal(fixture.state.audioInputDevices.find(device => device.deviceId === 'private-input')?.label, '');
	assert.equal(fixture.state.audioOutputDevices[0]?.label, '');
	const markup = render(<AudioDevicesFlyout controller={uiController} run={(operation: () => unknown) => operation()}
		snapshot={{ audioDevices: { inputs: fixture.state.audioInputDevices, outputs: fixture.state.audioOutputDevices } }} audioHostRuntime={null}
		copy={{ ...ENGLISH_COPY, recordingInputUnnamedDevice: 'Audiogerät {number}' }} />);
	assert.match(markup, /value="private-input">Audiogerät 1/u);
	assert.match(markup, /value="private-output">Audiogerät 1/u);
	assert.match(markup, /Authored \$&amp; \{number\}/u);
});

test('a real native session device-loss event has localized primary guidance and retains its backend reason as diagnostic detail', async () => {
	let settings = { host: 'wasapi', recordingSampleRate: 48_000, preferredInputDeviceId: '', preferredOutputDeviceId: '', preferredInputChannelCount: 1 };
	const controller: SoundscaperAudioHostController = { getSnapshot: () => ({ audioDevices: settings }), subscribe: () => () => undefined,
		actions: { audioDevices: { setHostInventory: async host => { settings = { ...settings, host }; }, requestAccess: async () => undefined } } };
	const bridge = { nativeAudioHelperAvailability: async () => ({ enabled: true, quarantined: false, payload: { status: 'available', detail: '' }, backends: ['wasapi'] }),
		setNativeAudioHelperEnabled: async () => true,
		describeNativeAudioBackend: async () => ({ status: 'described', inventory: { backend: 'wasapi', status: 'ready', devices: [{ handle: 'input', label: '', direction: 'input', channelCount: 1 }] } }),
		openNativeAudioSession: async () => ({ status: 'opened', sessionId: 'session' }), bindNativeAudioSession: async () => undefined,
		closeNativeAudioSession: async () => true } as unknown as SoundscaperNativeServicesBridge;
	const runtime = createSoundscaperAudioHostRuntime({ controller, bridge, engine: { getAudioContext: async () => ({ sampleRate: 48_000 }) as AudioContext } });
	try {
		await runtime.refresh(); runtime.reportDeviceLoss('session', 'Original backend reason');
		assert.equal(runtime.getSnapshot().failureCode, 'device-loss');
		const markup = render(<AudioDevicesFlyout controller={uiController} run={(operation: () => unknown) => operation()} snapshot={{ audioDevices: settings }}
			audioHostRuntime={runtime} copy={{ ...ENGLISH_COPY, audioHostDeviceLost: 'Gerät getrennt. Geräte aktualisieren oder anderen Host wählen.' }} />);
		assert.match(markup, /role="alert">Gerät getrennt\. Geräte aktualisieren oder anderen Host wählen\.<\/p>/u);
		assert.match(markup, /<details>.*Original backend reason/su);
	} finally { await runtime.dispose(); }
});

function render(element: React.ReactNode): string {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	try { return renderToStaticMarkup(element); } finally {
		if (previous) Object.defineProperty(globalThis, 'React', previous); else Reflect.deleteProperty(globalThis, 'React');
	}
}
