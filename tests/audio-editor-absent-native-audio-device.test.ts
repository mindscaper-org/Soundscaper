/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperAudioHostRuntime, type SoundscaperAudioHostController } from '../src/common/editor/ui/soundscaper-audio-host-runtime.ts';
import type { NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { soundscaperNativeAudioDestination } from '../src/common/editor/soundscaper-native-audio-renderer.ts';
import type { NativeAudioDeviceReport } from '../src/common/editor/controller/recording/native-audio-inventory.ts';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';

const input = 'native:alsa:in:studio-input';
const output = 'native:alsa:out:studio-output';
const studio = [
	{ handle: 'studio-input', label: 'Studio microphone', direction: 'input', channelCount: 1 },
	{ handle: 'studio-output', label: 'Studio speakers', direction: 'output', channelCount: 2 },
] as const;
const system = { handle: 'default', label: 'System default PCM', direction: 'duplex', channelCount: 2, isDefault: true } as const;

for (const missing of ['input', 'output'] as const) {
	test(`a saved native ${missing} stays selected while absent and returns without reopening its sibling`, async () => {
		const fixture = createHost([system, ...studio.filter(device => device.direction !== missing)]);
		const sibling = missing === 'input' ? 'output' : 'input';
		try {
			await fixture.runtime.refresh();
			assert.deepEqual(fixture.opened.map(request => request.direction), [sibling]);
			assert.equal(fixture.runtime.getSnapshot().failureCode, 'device-loss');
			assert.equal(fixture.state.preferredInputDeviceId, input);
			assert.equal(fixture.state.preferredOutputDeviceId, output);
			assert.deepEqual(fixture.persisted().map(settings => [settings.inputDeviceId, settings.outputDeviceId]), [[input, output]]);
			if (missing === 'output') assert.notEqual(fixture.destination(), fixture.context.destination);
			await fixture.runtime.refresh();
			assert.equal(fixture.opened.length, 1);
			assert.deepEqual(fixture.closed, []);
			await fixture.runtime.setRecordingSampleRate(44_100);
			assert.equal(fixture.state.preferredRecordingSampleRate, 48_000);
			assert.deepEqual(fixture.closed, []);
			fixture.inventory([system, ...studio]);
			await fixture.runtime.refresh();
			assert.equal(fixture.runtime.getSnapshot().error, '');
			assert.deepEqual(fixture.opened.map(request => request.direction), [sibling, missing]);
			assert.deepEqual(fixture.closed, []);
			fixture.inventory([system, ...studio.filter(device => device.direction !== missing)]);
			await fixture.runtime.refresh();
			assert.deepEqual(fixture.closed, ['session-2']);
			assert.equal(fixture.state.preferredInputDeviceId, input);
			assert.equal(fixture.state.preferredOutputDeviceId, output);
		} finally { await fixture.runtime.dispose(); }
	});
}

test('a completely empty native inventory protects the saved speakers and accepts an explicit default after refresh', async () => {
	const fixture = createHost([]);
	try {
		await fixture.runtime.refresh();
		assert.equal(fixture.runtime.getSnapshot().failureCode, 'device-loss');
		assert.notEqual(fixture.destination(), fixture.context.destination);
		assert.equal(fixture.opened.length, 0);
		fixture.inventory([system]);
		await fixture.runtime.refresh();
		await fixture.selectSystemDefault();
		assert.deepEqual(fixture.opened.map(request => [request.direction, request.candidates[0]?.deviceHandle]), [
			['input', 'default'], ['output', 'default'],
		]);
		assert.equal(fixture.runtime.getSnapshot().error, '');
	} finally { await fixture.runtime.dispose(); }
});

function createHost(initialDevices: readonly NativeAudioDeviceReport[]) {
	const fixture = createFixture();
	const { state, service } = fixture;
	state.audioHost = 'alsa';
	state.preferredInputDeviceId = input;
	state.preferredOutputDeviceId = output;
	const subscribers = new Set<() => void>();
	let devices = initialDevices;
	const opened: NativeAudioSessionOpenRequestV1[] = [], closed: string[] = [];
	const context = new MockAudioContext({ sampleRate: 48_000 }) as unknown as AudioContext;
	const controller: SoundscaperAudioHostController = {
		getSnapshot: () => ({ audioDevices: { host: state.audioHost, preferredInputDeviceId: state.preferredInputDeviceId,
			preferredOutputDeviceId: state.preferredOutputDeviceId, preferredInputChannelCount: state.preferredInputChannelCount,
			recordingSampleRate: state.preferredRecordingSampleRate } }),
		subscribe: listener => { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
		actions: { audioDevices: {
			setHostInventory: service.setHostInventory,
			setRecordingSampleRate: service.setRecordingSampleRate,
			requestAccess: async () => undefined,
		} },
	};
	const bridge = {
		nativeAudioHelperAvailability: async () => ({ enabled: true, quarantined: false,
			payload: { status: 'available', detail: '', reason: null }, backends: ['alsa'] }),
		setNativeAudioHelperEnabled: async () => true,
		describeNativeAudioBackend: async () => ({ status: 'described', inventory: { backend: 'alsa', detail: '', status: 'available', devices } }),
		openNativeAudioSession: async (request: NativeAudioSessionOpenRequestV1) => {
			opened.push(request);
			return { status: 'opened', sessionId: `session-${String(opened.length)}` };
		},
		bindNativeAudioSession: async () => ({ status: 'bound' }),
		closeNativeAudioSession: async ({ sessionId }: { sessionId: string }) => { closed.push(sessionId); return true; },
	} as unknown as SoundscaperNativeServicesBridge;
	const runtime = createSoundscaperAudioHostRuntime({ bridge, controller, engine: { getAudioContext: async () => context } });
	return { runtime, state, opened, closed, context,
		destination: () => soundscaperNativeAudioDestination(context, context.destination),
		inventory: (value: readonly NativeAudioDeviceReport[]) => { devices = value; },
		persisted: () => fixture.persistCalls.filter(([key]) => key === 'audio-devices').map(([, settings]) => settings as {
			inputDeviceId: string; outputDeviceId: string;
		}),
		async selectSystemDefault() {
			await service.setPreferredInputDevice('default');
			await service.setAudioOutputDevice('');
			for (const listener of subscribers) listener();
			await runtime.settle();
		},
	};
}
