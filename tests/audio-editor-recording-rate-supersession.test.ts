/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioEditorController, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { deferred } from './helpers/async-test-control.ts';
import { createFixture } from './helpers/recording-routing-service-fixture.ts';
import { createSoundscaperAudioHostRuntime } from '../src/common/editor/ui/soundscaper-audio-host-runtime.ts';
import type { NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';

function rate(snapshot: { readonly audioDevices: unknown }): unknown {
	assert.ok(snapshot.audioDevices && typeof snapshot.audioDevices === 'object');
	return Reflect.get(snapshot.audioDevices, 'recordingSampleRate');
}

test('a superseded native recording rate retires quietly after the latest public request succeeds', async context => {
	const oldClose = deferred<void>();
	let firstContext = true;
	let closing = false;
	const engine = createAudioEditorEngine({ audioContextFactory: (options?: AudioContextOptions) => {
		const audio = new MockAudioContext(options);
		if (firstContext) audio.close = async () => {
			closing = true;
			await oldClose.promise;
			audio.state = 'closed';
		};
		firstContext = false;
		return audio as unknown as EngineAudioContext;
	} });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', projectRuntime: runtime, sessionController: runtime.createSessionController(), engine,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
	});
	context.after(async () => { oldClose.resolve(); await controller.dispose(); });
	await controller.ready;
	await controller.actions.audioDevices.setHostInventory('alsa', {
		backend: 'alsa', status: 'ready', detail: '', devices: [],
	});
	await engine.getAudioContext({ resume: false });
	const older = Promise.allSettled([controller.actions.audioDevices.setRecordingSampleRate(44_100)]);
	assert.equal(closing, true);
	await controller.actions.audioDevices.setRecordingSampleRate(96_000);
		assert.equal(rate(controller.getSnapshot()), 96_000);
	assert.equal((await engine.getAudioContext({ resume: false })).sampleRate, 96_000);
	oldClose.resolve();
	const [outcome] = await older;
	assert.equal(outcome?.status, 'rejected');
	if (outcome?.status === 'rejected') {
		assert.ok(outcome.reason instanceof DOMException);
		assert.equal(outcome.reason.name, 'AbortError', 'obsolete context preparation is expected cancellation');
	}
		assert.equal(rate(controller.getSnapshot()), 96_000);
});

test('a current native recording-rate failure remains visible and preserves the saved rate', async context => {
	const failure = new DOMException('The selected audio rate is unavailable.', 'NotSupportedError');
	const engine = createAudioEditorEngine({ audioContextFactory: (options?: AudioContextOptions) => {
		if (options?.sampleRate === 96_000) throw failure;
		return new MockAudioContext(options) as unknown as EngineAudioContext;
	} });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', projectRuntime: runtime, sessionController: runtime.createSessionController(), engine,
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.audioDevices.setHostInventory('alsa', {
		backend: 'alsa', status: 'ready', detail: '', devices: [],
	});
	await assert.rejects(controller.actions.audioDevices.setRecordingSampleRate(96_000), error => error === failure);
		assert.equal(rate(controller.getSnapshot()), 48_000);
});

for (const failure of ['refused', 'disconnected', 'storage'] as const) test(`native sample rate change preserves the saved rate after ${failure}`, async () => {
	let audioContext = new MockAudioContext({ sampleRate: 48_000 }) as unknown as AudioContext;
	const engine = { async getAudioContext({ sampleRate }: Readonly<{ sampleRate?: number | null }> = {}) {
		if (sampleRate != null && audioContext.sampleRate !== sampleRate) audioContext = new MockAudioContext({ sampleRate }) as unknown as AudioContext;
		return audioContext;
	} };
	const fixture = createFixture({ getAudioContext: engine.getAudioContext, persistSetting: async (key, value) => {
		if (failure === 'storage' && key === 'audio-devices' && (value as { recordingSampleRate: number }).recordingSampleRate === 8_000) {
			throw new Error('Audio preferences could not be saved.');
		}
		return value;
	} });
	fixture.state.audioHost = 'asio';
	fixture.state.preferredInputDeviceId = 'native:asio:in:microphone';
	fixture.state.preferredOutputDeviceId = 'native:asio:out:speakers';
	const active = new Map<string, NativeAudioSessionOpenRequestV1>();
	const meterFinishes: string[] = [];
	let attempt = 0, triedRate = false;
	const bridge = {
		nativeAudioHelperAvailability: async () => ({ backends: ['asio'], payload: { status: 'available' } }),
		setNativeAudioHelperEnabled: async () => true,
		describeNativeAudioBackend: async () => ({ status: 'described', inventory: { backend: 'asio', status: 'available', detail: '', devices: [
			{ handle: 'microphone', label: 'Microphone', direction: 'input' }, { handle: 'speakers', label: 'Speakers', direction: 'output' },
		] } }),
		openNativeAudioSession: async (request: NativeAudioSessionOpenRequestV1) => {
			if (request.sampleRate === 8_000) {
				triedRate = true;
				if (failure !== 'storage') return { status: 'refused', code: 'format-refused', message: 'Unsupported rate.' };
			}
			if (triedRate && failure === 'disconnected' && request.direction === 'input') {
				return { status: 'refused', code: 'device-unavailable', message: 'Interface disconnected.' };
			}
			const sessionId = `session-${++attempt}`;
			active.set(sessionId, request);
			return { status: 'opened', sessionId };
		},
		bindNativeAudioSession: async () => {},
		closeNativeAudioSession: async ({ sessionId }: Readonly<{ sessionId: string }>) => active.delete(sessionId),
	} as unknown as SoundscaperNativeServicesBridge;
	const runtime = createSoundscaperAudioHostRuntime({ engine, bridge, controller: {
		getSnapshot: () => ({ audioDevices: { host: fixture.state.audioHost, recordingSampleRate: fixture.state.preferredRecordingSampleRate,
			preferredInputDeviceId: fixture.state.preferredInputDeviceId, preferredOutputDeviceId: fixture.state.preferredOutputDeviceId,
			preferredInputChannelCount: fixture.state.preferredInputChannelCount } }), subscribe: () => () => {},
		actions: {
			audioDevices: { ...fixture.service, requestAccess: fixture.service.requestInputAccess },
			recording: { prepareInputReplacement: () => ({ finish: async outcome => {
				meterFinishes.push(outcome);
				if (outcome === 'ready' && ![...active.values()].some(request => request.direction === 'input')) {
					throw new Error('No input available to meter.');
				}
			} }) },
		},
	} });
	try {
		await runtime.refresh();
		assert.equal(active.size, 2);
		await runtime.setRecordingSampleRate(8_000);
		assert.equal(triedRate, true);
		assert.equal(meterFinishes.at(-1), failure === 'disconnected' ? 'failed' : 'ready');
		assert.equal(runtime.getSnapshot().failureCode, { refused: 'rate-mismatch', disconnected: 'session-open', storage: 'operation' }[failure]);
		assert.match(runtime.getSnapshot().error, failure === 'storage' ? /Audio preferences could not be saved/u : /Unsupported rate/u);
		assert.equal(fixture.state.preferredRecordingSampleRate, 48_000);
		if (failure !== 'storage') assert.ok(fixture.persistCalls.every(([, value]) => (value as { recordingSampleRate?: number }).recordingSampleRate !== 8_000));
		assert.equal(audioContext.sampleRate, 48_000);
		if (failure === 'disconnected') {
			assert.deepEqual([...active.values()].map(({ direction, sampleRate }) => [direction, sampleRate]), [['output', 48_000]]);
			assert.match(runtime.getSnapshot().error, /Interface disconnected/u);
		} else {
			assert.deepEqual([...active.values()].map(({ direction, sampleRate }) => [direction, sampleRate]), [['input', 48_000], ['output', 48_000]]);
			await runtime.setRecordingSampleRate(96_000);
			assert.deepEqual([...active.values()].map(request => request.sampleRate), [96_000, 96_000]);
			assert.equal(fixture.state.preferredRecordingSampleRate, 96_000);
			assert.equal(runtime.getSnapshot().failureCode, null);
		}
	} finally { await runtime.dispose(); }
});
