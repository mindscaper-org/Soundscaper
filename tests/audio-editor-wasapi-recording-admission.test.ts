/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireRecordingHardwareInput } from '../src/common/editor/controller/recording/internal/recording-hardware-admission.ts';
import type { RecordingCapturePool, RecordingMediaStream } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { createSoundscaperAudioHostRuntime, type SoundscaperAudioHostController } from '../src/common/editor/ui/soundscaper-audio-host-runtime.ts';
import type { NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { claimSoundscaperNativeAudioCapture, soundscaperNativeAudioCaptureSource } from '../src/common/editor/soundscaper-native-audio-capture.ts';
import { requestHardwareInput } from '../src/common/editor/recording-inputs.js';
import { deferred } from './helpers/async-test-control.ts';

const PRIMARY = 'native:wasapi:in:primary';
const PIN = 'native:wasapi:in:pinned';

for (const outcome of ['success', 'refusal', 'loss', 'cancel', 'dispose', 'repeat'] as const) test(`single WASAPI pin admission owns the temporary route through ${outcome}`, async () => {
	const listeners = new Set<() => void>(), active = new Map<string, NativeAudioSessionOpenRequestV1>();
	const notify = () => { for (const listener of listeners) listener(); };
	const opens = deferred<void>(), allowOpen = deferred<void>(), acquiring = deferred<void>(), allowAcquire = deferred<void>();
	const restoring = deferred<void>(), allowRestore = deferred<void>();
	const restoringCapture = deferred<void>(), allowRestoreCapture = deferred<void>();
	const controllerSignal = new AbortController();
	const captures = new Map<string, ReturnType<typeof claimSoundscaperNativeAudioCapture>>();
	function captureToken() { return { clone: captureToken, getTracks: () => [], getAudioTracks: () => [] }; }
	const context = { sampleRate: 48_000, createMediaStreamDestination: () => ({ stream: captureToken() }) } as unknown as AudioContext;
	const primaryNode = {} as AudioNode;
	let sequence = 0, recordingStarting = false, recording = false, acquisitions = 0, holdRestore = false;
	let settings = { host: 'wasapi', preferredInputDeviceId: PRIMARY, preferredOutputDeviceId: 'native:wasapi:out:speaker',
		preferredInputChannelCount: 1, recordingSampleRate: 48_000 };
	const controller: SoundscaperAudioHostController = {
		getSnapshot: () => ({ audioDevices: settings, recordingStarting, recording }),
		subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		actions: { audioDevices: {
			setHostInventory: async host => { settings = { ...settings, host }; },
			setRecordingSampleRate: async rate => { settings = { ...settings, recordingSampleRate: rate }; },
			requestAccess: async () => {},
		} },
	};
	const bridge = {
		nativeAudioHelperAvailability: async () => ({ payload: { status: 'available' }, backends: ['wasapi'] }),
		setNativeAudioHelperEnabled: async () => {
			if (holdRestore) { restoring.resolve(); await allowRestore.promise; }
			return true;
		},
		describeNativeAudioBackend: async () => ({ status: 'described', inventory: { backend: 'wasapi', devices: [
			{ handle: 'primary', direction: 'input', channelCount: 2, isDefault: true },
			{ handle: 'pinned', direction: 'input', channelCount: 2 },
			{ handle: 'speaker', direction: 'output', channelCount: 2, isDefault: true },
		] } }),
		openNativeAudioSession: async (request: NativeAudioSessionOpenRequestV1) => {
			if (request.candidates[0]?.deviceHandle === 'pinned') {
				opens.resolve();
				await allowOpen.promise;
				if (outcome === 'refusal') return { status: 'refused', message: 'Pinned input disconnected.' };
			}
			const sessionId = `session-${++sequence}`;
			active.set(sessionId, request);
			return { status: 'opened', sessionId };
		},
		bindNativeAudioSession: async ({ sessionId }: { sessionId: string }) => {
			const request = active.get(sessionId), handle = request?.candidates[0]?.deviceHandle;
			if (!request || request.direction === 'output') return;
			if (outcome === 'loss' && handle === 'pinned') {
				active.delete(sessionId);
				runtime.reportDeviceLoss(sessionId, 'device-loss');
				return;
			}
			const capture = claimSoundscaperNativeAudioCapture({ sessionId, context, node: handle === 'primary' ? primaryNode : {} as AudioNode,
				deviceId: `native:wasapi:in:${handle}`, channelCount: request.channelCount, sampleRate: request.sampleRate });
			captures.set(sessionId, capture);
			if (outcome === 'repeat' && handle === 'primary' && sequence > 2) {
				restoringCapture.resolve();
				await allowRestoreCapture.promise;
			}
			capture.activate();
		},
		closeNativeAudioSession: async ({ sessionId }: { sessionId: string }) => {
			captures.get(sessionId)?.revoke(); captures.delete(sessionId); active.delete(sessionId); return true;
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const stream = { getAudioTracks: () => [] } as RecordingMediaStream;
	const pool: RecordingCapturePool = {
		async acquireHardware(deviceId) {
			acquisitions += 1;
			if (![...active.values()].some(request => deviceId === `native:wasapi:in:${request.candidates[0]?.deviceHandle}`)) throw new Error('No exact capture lease.');
			acquiring.resolve();
			await allowAcquire.promise;
			return stream;
		},
		async acquireDisplay() { throw new Error('Unexpected display acquisition.'); },
	};
	const runtime = createSoundscaperAudioHostRuntime({ controller, bridge, engine: { getAudioContext: async () => context } });
	const pin = { deviceId: PIN, channelCount: 2, sampleRate: 48_000, signal: controllerSignal.signal };
	try {
		await runtime.refresh();
		const speaker = active.get('session-2');
		assert.ok(speaker);
		recordingStarting = true; notify();
		if (outcome === 'success') {
			await assert.rejects(acquireRecordingHardwareInput(pool, { deviceId: PIN, channelCount: 2, sampleRate: 48_000 }, false), /No exact capture lease/u);
			await assert.rejects(acquireRecordingHardwareInput(pool, { deviceId: PIN, channelCount: 2, sampleRate: 96_000 }, true), /sample rate changed/u);
			assert.deepEqual([...active.keys()], ['session-1', 'session-2']);
			acquisitions = 0;
		}
		const take = Promise.allSettled([acquireRecordingHardwareInput(pool, pin, true)]);
		await opens.promise;
		notify();
		assert.equal(acquisitions, 0, 'Record admission must wait for the exact input');
		if (outcome === 'cancel') {
			controllerSignal.abort();
			recordingStarting = false; notify();
		}
		const disposal = outcome === 'dispose' ? runtime.dispose() : null;
		allowOpen.resolve();
		if (outcome === 'success' || outcome === 'repeat') {
			await acquiring.promise;
			notify();
			await runtime.settle();
			assert.equal(active.get('session-3')?.channelCount, 2, 'the pin survives notifications between prepare and acquire');
			assert.equal(active.get('session-2'), speaker);
			allowAcquire.resolve();
			assert.deepEqual(await take, [{ status: 'fulfilled', value: stream }]);
			recording = true; recordingStarting = false; notify();
			await runtime.settle();
			assert.ok(active.has('session-3'));
		} else {
			const result = (await take)[0];
			assert.equal(result?.status, 'rejected');
			assert.equal(acquisitions, 0, 'unavailable and cancelled preparations must never reach capture acquisition');
			if (outcome === 'refusal' && result?.status === 'rejected') assert.match(String(result.reason), /Pinned input disconnected/u);
		}
		if (outcome === 'repeat') {
			holdRestore = true;
			recording = false; notify();
			await restoring.promise;
			await assert.rejects(requestHardwareInput({ channelCount: 1, sampleRate: 48_000 }), /default microphone is being restored/u);
			recordingStarting = true; notify();
			const again = acquireRecordingHardwareInput(pool, pin, true);
			holdRestore = false; allowRestore.resolve();
			assert.equal(await again, stream);
			assert.ok(active.has('session-3'));
		}
		recordingStarting = false; recording = false; notify();
		if (outcome === 'repeat') {
			await restoringCapture.promise;
			await assert.rejects(requestHardwareInput({ channelCount: 1, sampleRate: 48_000 }), /default microphone is being restored/u);
			allowRestoreCapture.resolve();
		}
		await runtime.settle();
		assert.equal(settings.preferredInputDeviceId, PRIMARY);
		if (disposal) {
			await disposal;
			assert.equal(active.size, 0);
		} else {
			assert.equal(active.get('session-2'), speaker);
			assert.deepEqual([...active.values()].map(request => request.candidates[0]?.deviceHandle), ['speaker', 'primary']);
			const restored = await requestHardwareInput({ channelCount: 1, sampleRate: 48_000 });
			assert.equal(soundscaperNativeAudioCaptureSource(restored, context), primaryNode);
		}
	} finally {
		allowOpen.resolve(); allowAcquire.resolve(); allowRestore.resolve(); allowRestoreCapture.resolve();
		await runtime.dispose();
	}
});
