/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createSoundscaperAudioHostRuntime,
	type SoundscaperAudioHostController,
} from '../src/common/editor/ui/soundscaper-audio-host-runtime.ts';
import type { NativeAudioDeviceReport, NativeAudioInventoryReport } from '../src/common/editor/controller/recording/native-audio-inventory.ts';
import type { NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';

test('native host selection replaces the inventory and connects the selected devices at the recording rate', async () => {
	const fixture = hostFixture();
	await fixture.runtime.refresh();
	assert.deepEqual(fixture.runtime.getSnapshot().hosts.map((host) => host.id), ['electron', 'wasapi', 'asio']);
	assert.equal(fixture.accessRequests(), 1, 'Electron obtains microphone access automatically');
	await fixture.runtime.setHost('wasapi');
	assert.equal(fixture.settings().host, 'wasapi');
	assert.deepEqual(fixture.described, ['wasapi']);
	assert.deepEqual(fixture.inventory()?.devices.map((device) => device.handle), ['input-wasapi', 'output-wasapi']);
	assert.deepEqual(fixture.opened.map((request) => [request.direction, request.sampleRate, request.channelCount]), [
		['input', 96_000, 1], ['output', 96_000, 2],
	]);
	assert.deepEqual(fixture.bound, ['session-1', 'session-2']);
	await fixture.runtime.setHost('asio');
	assert.deepEqual(fixture.closed, ['session-1', 'session-2']);
	assert.equal(fixture.opened[2]?.candidates[0]?.backend, 'asio');
	assert.equal(fixture.opened[2]?.mode, 'exclusive');
	await fixture.runtime.setHost('electron');
	assert.equal(fixture.inventory(), null);
	assert.equal(fixture.accessRequests(), 2);
	await fixture.runtime.dispose();
});

test('restoring a native host connects it before any device dialog opens and preferences reconnect the next route', async () => {
	const fixture = hostFixture('wasapi');
	await fixture.runtime.refresh();
	assert.equal(fixture.accessRequests(), 0);
	assert.equal(fixture.opened.length, 2);
	fixture.change({ recordingSampleRate: 44_100, preferredInputChannelCount: 2 });
	await fixture.runtime.settle();
	assert.deepEqual(fixture.closed, ['session-1', 'session-2']);
	assert.equal(fixture.opened[2]?.sampleRate, 44_100);
	assert.equal(fixture.opened[2]?.channelCount, 2);
	await fixture.runtime.dispose();
});

test('a failed native open closes partial routes and leaves an actionable audio settings error', async () => {
	const fixture = hostFixture('electron', true);
	await fixture.runtime.setHost('wasapi');
	assert.match(fixture.runtime.getSnapshot().error, /device is busy/u);
	assert.equal(fixture.runtime.getSnapshot().pending, false);
	assert.deepEqual(fixture.closed, ['session-1']);
	await fixture.runtime.dispose();
});

test('a disposed host never publishes an inventory returned by a late enumeration', async () => {
	const fixture = hostFixture();
	await fixture.runtime.refresh();
	const pending = fixture.runtime.setHost('wasapi');
	const disposal = fixture.runtime.dispose();
	await Promise.all([pending, disposal]);
	assert.equal(fixture.opened.length, 0);
});

test('scheduled recording protects the current native sessions from host changes and refresh', async () => {
	for (const preparing of [true, false]) {
		const fixture = hostFixture('wasapi');
		try {
			await fixture.runtime.refresh();
			fixture.schedule(true, preparing);
			await fixture.runtime.setHost('electron');
			await fixture.runtime.refresh();
			assert.match(fixture.runtime.getSnapshot().error, /scheduled recording/u);
			assert.deepEqual(fixture.closed, []);
			assert.equal(fixture.settings().host, 'wasapi');
		} finally { await fixture.runtime.dispose(); }
	}
});

test('choosing another input reopens the native input while retaining the selected output device', async () => {
	const fixture = hostFixture('wasapi', false, [
		{ handle: 'first', label: 'First', direction: 'input', channelCount: 2, isDefault: true },
		{ handle: 'second', label: 'Second', direction: 'input', channelCount: 2 },
		{ handle: 'speakers', label: 'Speakers', direction: 'output', channelCount: 2 },
	]);
	await fixture.runtime.refresh();
	fixture.change({ preferredInputDeviceId: 'native:wasapi:in:second', preferredOutputDeviceId: 'native:wasapi:out:speakers' });
	await fixture.runtime.settle();
	assert.equal(fixture.opened[2]?.candidates[0]?.deviceHandle, 'second');
	assert.equal(fixture.opened[3]?.candidates[0]?.deviceHandle, 'speakers');
	await fixture.runtime.dispose();
});

test('asymmetric devices use separate exact channel requests instead of an invalid duplex format', async () => {
	const fixture = hostFixture('wasapi', false, [
		{ handle: 'interface', label: 'Mono input', direction: 'input', channelCount: 1 },
		{ handle: 'interface', label: 'Stereo output', direction: 'output', channelCount: 2 },
	]);
	await fixture.runtime.refresh();
	assert.deepEqual(fixture.opened.map((request) => [request.direction, request.channelCount]), [['input', 1], ['output', 2]]);
	fixture.runtime.reportDeviceLoss('session-1', 'device-loss');
	assert.match(fixture.runtime.getSnapshot().error, /disconnected.*Refresh audio devices/u);
	await fixture.runtime.dispose();
});

test('failed native session cleanup retains ownership for a disposal retry', async () => {
	const fixture = hostFixture('wasapi');
	await fixture.runtime.refresh();
	fixture.failClose(true);
	await assert.rejects(fixture.runtime.dispose(), /planned close failure/u);
	fixture.failClose(false);
	await fixture.runtime.dispose();
	assert.deepEqual(fixture.closed, ['session-1', 'session-2']);
});

test('a refused context-rate change preserves the working native devices', async () => {
	const fixture = hostFixture('wasapi');
	await fixture.runtime.refresh();
	fixture.failRate(true);
	fixture.change({ recordingSampleRate: 44_100 });
	await fixture.runtime.settle();
	assert.match(fixture.runtime.getSnapshot().error, /planned rate refusal/u);
	assert.deepEqual(fixture.closed, []);
	await fixture.runtime.dispose();
});

function hostFixture(host = 'electron', failOutput = false, devices?: readonly NativeAudioDeviceReport[]) {
	let settings = { host, recordingSampleRate: 96_000, preferredInputDeviceId: '',
		preferredOutputDeviceId: '', preferredInputChannelCount: 1 };
	let inventory: NativeAudioInventoryReport | null = null;
	let requests = 0;
	let enabled = false;
	let sequence = 0;
	let scheduled = false;
	let preparingSchedule = false;
	let failClose = false;
	let failRate = false;
	const listeners = new Set<() => void>();
	const described: string[] = [];
	const opened: NativeAudioSessionOpenRequestV1[] = [];
	const bound: string[] = [];
	const closed: string[] = [];
	const controller: SoundscaperAudioHostController = {
		getSnapshot: () => ({ audioDevices: settings, recordingScheduling: scheduled && preparingSchedule,
			scheduledRecording: scheduled && !preparingSchedule ? { startTimeMs: 100 } : null }),
		subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		actions: { audioDevices: {
			setHostInventory: async (next, value) => { settings = { ...settings, host: next }; inventory = value; },
			requestAccess: async () => { requests += 1; },
		} },
	};
	const bridge = {
		nativeAudioHelperAvailability: async () => ({ enabled, quarantined: false,
			payload: { status: 'available', reason: null, detail: '' }, backends: ['wasapi', 'asio', 'jack'] }),
		setNativeAudioHelperEnabled: async (value: boolean) => { enabled = value; return value; },
		describeNativeAudioBackend: async ({ backend }: { backend: string }) => {
			described.push(backend);
			return { status: 'described', inventory: { backend, status: 'ready', detail: '', devices: devices ?? [
				{ handle: `input-${backend}`, label: 'Microphone', direction: 'input', channelCount: 2, isDefault: true },
				{ handle: `output-${backend}`, label: 'Speakers', direction: 'output', channelCount: 2, isDefault: true },
			] } };
		},
		openNativeAudioSession: async (request: NativeAudioSessionOpenRequestV1) => {
			opened.push(request);
			if (failOutput && request.direction === 'output') return { status: 'refused', message: 'The audio device is busy.' };
			return { status: 'opened', sessionId: `session-${String(++sequence)}`, backend: request.candidates[0]?.backend,
				deviceHandle: request.candidates[0]?.deviceHandle, format: request, attempts: [] };
		},
		bindNativeAudioSession: async ({ sessionId }: { sessionId: string }) => { bound.push(sessionId); },
		closeNativeAudioSession: async ({ sessionId }: { sessionId: string }) => {
			if (failClose) throw new Error('planned close failure');
			closed.push(sessionId); return true;
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const runtime = createSoundscaperAudioHostRuntime({ controller, bridge,
		engine: { getAudioContext: async () => {
			if (failRate) throw new Error('planned rate refusal');
			return { sampleRate: settings.recordingSampleRate } as AudioContext;
		} } });
	return { runtime, opened, described, bound, closed, settings: () => settings,
		schedule: (value: boolean, preparing = false) => { scheduled = value; preparingSchedule = preparing; },
		failClose: (value: boolean) => { failClose = value; },
		failRate: (value: boolean) => { failRate = value; },
		inventory: () => inventory, accessRequests: () => requests,
		change: (patch: Partial<typeof settings>) => { settings = { ...settings, ...patch }; for (const listener of listeners) listener(); },
	};
}
