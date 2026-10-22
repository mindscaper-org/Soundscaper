/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { AudioDevicesFlyout } from '../src/common/editor/ui/toolbar/AudioDevicesFlyout.jsx';
import { createNativeAudioRouteOpenRequest } from '../src/common/editor/ui/soundscaper-native-audio-route.ts';
import { runSoundscaperNativeServicesAction } from '../src/common/editor/ui/soundscaper-native-services-dialog-model.ts';
import type { NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });

import type { SoundscaperAudioHostRuntime } from '../src/common/editor/ui/soundscaper-audio-host-runtime.ts';

function setup(host = 'electron', inputAccess = false, hasOpenInputs = false) {
	const state = { host, hosts: [{ id: 'electron', label: 'Electron' }, { id: 'wasapi', label: 'WASAPI' },
		{ id: 'asio', label: 'ASIO' }], pending: false, error: '' };
	const runtime = { getSnapshot: () => state, subscribe: () => () => undefined,
		setHost: async () => undefined, refresh: async () => undefined, dispose: async () => undefined } as unknown as SoundscaperAudioHostRuntime;
	return {
		copy: ENGLISH_COPY,
		snapshot: { audioDevices: { host, recordingSampleRate: 96_000, inputSupported: true,
			outputSupported: true, microphoneInputSupported: true, inputAccess,
			preferredInputDeviceId: 'native:asio:in:studio', preferredInputChannelCount: 2,
			inputs: [{ deviceId: 'native:asio:in:studio', label: 'Studio input', channelCount: 8 }],
			outputs: [{ deviceId: 'native:asio:out:studio', label: 'Studio output' }] },
			recordingInputs: { hasOpenInputs } },
		controller: { actions: { audioDevices: {}, recording: { requestInputAccess: async () => undefined } } },
		run: (operation: () => unknown) => operation(),
		audioHostRuntime: runtime,
	};
}

test('Audio setup and Audio settings share the host choices and native recording sample rate', () => {
	for (const heading of [true, false]) {
		const markup = renderToStaticMarkup(<AudioDevicesFlyout {...setup('asio')} heading={heading} />);
		assert.match(markup, /aria-label="Host"/u);
		assert.match(markup, /value="asio" selected=""/u);
		assert.match(markup, />Electron<\/option>/u);
		assert.match(markup, />WASAPI<\/option>/u);
		assert.match(markup, /aria-label="Recording sample rate"/u);
		assert.match(markup, /value="96000" selected="">96000 Hz/u);
		assert.match(markup, /Choose the number of channels for your next recording/u);
		assert.doesNotMatch(markup, /matching active track|Native audio and latency|Use Native Audio Helper/u);
	}
});

test('Electron never offers microphone enable or release actions or an access prompt', () => {
	for (const access of [true, false]) for (const open of [true, false]) {
		const markup = renderToStaticMarkup(<AudioDevicesFlyout {...setup('electron', access, open)} />);
		assert.doesNotMatch(markup, /Enable microphones|Release inputs|Enable microphones to show/u);
		assert.doesNotMatch(markup, /aria-label="Recording sample rate"/u);
	}
});

test('web keeps its permission action and does not advertise desktop hosts', () => {
	const props = setup('browser');
	const markup = renderToStaticMarkup(<AudioDevicesFlyout {...props} audioHostRuntime={null} />);
	assert.match(markup, /Enable microphones/u);
	assert.doesNotMatch(markup, /aria-label="Host"|>ASIO<\/option>|>Electron<\/option>/u);
});

test('native route requests retain the selected rate and reject incompatible ASIO modes', async () => {
	const request = createNativeAudioRouteOpenRequest({ candidates: [{ backend: 'asio', deviceHandle: 'studio' }],
		direction: 'input', mode: 'exclusive', sampleRate: 96_000, periodFrames: 256, channelCount: 2 });
	let opened: unknown;
	const event = await runSoundscaperNativeServicesAction({
		openNativeAudioSession: async (value: NativeAudioSessionOpenRequestV1) => { opened = value; return { status: 'opened', sessionId: 'session' }; },
		nativeAudioSessionStatus: async () => ({ sessionId: 'session', format: request }),
	} as unknown as SoundscaperNativeServicesBridge, { type: 'open-audio-session', request });
	assert.equal(event.type, 'settled');
	assert.deepEqual(opened, request);
	assert.throws(() => createNativeAudioRouteOpenRequest({ ...request, mode: 'shared' }), /selection/iu);
	assert.throws(() => createNativeAudioRouteOpenRequest({ ...request, channelCount: 33 }), /bounds/iu);
});
