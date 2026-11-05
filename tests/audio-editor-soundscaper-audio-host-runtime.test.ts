/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createSoundscaperAudioHostRuntime,
	type SoundscaperAudioHostController,
} from '../src/common/editor/ui/soundscaper-audio-host-runtime.ts';
import type { NativeAudioDeviceReport, NativeAudioInventoryReport } from '../src/common/editor/controller/recording/native-audio-inventory.ts';
import type { NativeAudioSessionOpenRequestV1, SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import type { MicrophoneMeterInputReplacement } from '../src/common/editor/controller/recording/microphone-meter-service.ts';
import { deferred } from './helpers/async-test-control.ts';
import type { RecordingRoute } from '../src/common/editor/recording-routing.js';

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

for (const mode of ['ready', 'failed', 'superseded', 'disposed'] as const) test(`native input replacement owns meter retirement until its ${mode} attachment`, async () => {
	const entered = deferred<void>(), release = deferred<void>();
	const outcomes: string[] = [];
	let prepared = 0;
	const fixture = hostFixture('wasapi', false, undefined, {
		prepareInputReplacement: () => { const id = ++prepared; return { finish: async outcome => { outcomes.push(`${String(id)}:${outcome}`); } }; },
		bind: async id => { if (id === 'session-4' && mode !== 'failed') { entered.resolve(); await release.promise; } },
	});
	try {
		await fixture.runtime.refresh();
		assert.deepEqual(outcomes, ['1:ready']); outcomes.length = 0;
		if (mode === 'failed') fixture.failOutput(true);
		fixture.change({ recordingSampleRate: 44_100 });
		if (mode === 'failed') await fixture.runtime.settle();
		else {
			await entered.promise;
			assert.equal(prepared, 2);
			assert.deepEqual(outcomes, [], 'binding the new output is still pending');
			assert.deepEqual(fixture.closed, ['session-1', 'session-2']);
			if (mode === 'superseded') fixture.change({ recordingSampleRate: 88_200 });
			const disposed = mode === 'disposed' ? fixture.runtime.dispose() : null;
			release.resolve();
			await fixture.runtime.settle(); await disposed;
		}
		assert.deepEqual(outcomes, mode === 'superseded' ? ['2:superseded', '3:ready'] : [`2:${mode}`]);
		if (mode === 'failed') assert.match(fixture.runtime.getSnapshot().error, /device is busy/u);
	} finally { release.resolve(); await fixture.runtime.dispose(); }
});

test('disposing a ready native host retires its meter before closing the input without saving Disable', async () => {
	let metering = true, persisted = true, active = false;
	const fixture = hostFixture('wasapi', false, undefined, {
		prepareInputReplacement: () => { active = false; return { finish: async outcome => {
			if (outcome === 'ready') active = metering;
			if (outcome === 'disposed') { metering = false; active = false; }
		} }; },
		close: () => { if (active) { metering = false; persisted = false; } },
	});
	await fixture.runtime.refresh();
	assert.equal(active, true);
	await fixture.runtime.dispose();
	assert.equal(active, false);
	assert.equal(metering, false);
	assert.equal(persisted, true, 'intentional native-host disposal must not look like physical input loss');
});

test('disposing during native attachment releases a waiting meter before the driver returns', async () => {
	const entered = deferred<void>(), release = deferred<void>(), retired = deferred<void>();
	const fixture = hostFixture('wasapi', false, undefined, {
		prepareInputReplacement: () => ({ finish: async outcome => { if (outcome === 'disposed') retired.resolve(); } }),
		bind: async id => { if (id === 'session-2') { entered.resolve(); await release.promise; } },
	});
	const attaching = fixture.runtime.refresh(); await entered.promise;
	const disposing = fixture.runtime.dispose();
	let settled = false; void retired.promise.then(() => { settled = true; });
	await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
	try { assert.equal(settled, true, 'disposal must not wait for an uncancellable native bind'); }
	finally { release.resolve(); await Promise.all([attaching, disposing]); }
});

test('meter retirement precedes native AudioContext replacement', async () => {
	const events: string[] = [];
	const fixture = hostFixture('wasapi', false, undefined, {
		prepareInputReplacement: () => { events.push('retire'); return { finish: async () => {} }; },
		context: () => { events.push('context'); },
	});
	try { await fixture.runtime.refresh(); assert.deepEqual(events, ['retire', 'context']); }
	finally { await fixture.runtime.dispose(); }
});

test('an authored second native input reconnects the session instead of leaving a valid Record pin unavailable', async () => {
	const fixture = hostFixture('wasapi');
	try {
		await fixture.runtime.refresh();
		assert.equal(fixture.opened[0]?.channelCount, 1);
		fixture.changeRoutes({ track: { kind: 'device', deviceId: 'native:wasapi:in:input-wasapi', channelStart: 1, channelCount: 1 } });
		await fixture.runtime.settle();
		assert.equal(fixture.opened[2]?.channelCount, 2, 'Mono2 requires both physical input planes even while global Mono remains selected');
		assert.equal(fixture.settings().preferredInputChannelCount, 1);
		assert.equal(fixture.opened[2]?.candidates[0]?.deviceHandle, 'input-wasapi');
		assert.equal(fixture.opened[3]?.channelCount, 2, 'the selected speaker format is unchanged');
		fixture.changeRoutes({ track: { kind: 'device', deviceId: 'native:wasapi:in:input-wasapi', channelStart: 0, channelCount: 1 } });
		await fixture.runtime.settle();
		assert.equal(fixture.opened[4]?.channelCount, 1);
	} finally { await fixture.runtime.dispose(); }
});

test('restored native routes request their complete physical extent and ignore unrelated sources', async () => {
	const fixture = hostFixture('wasapi', false, [
		{ handle: 'input-wasapi', label: 'Eight-input interface', direction: 'input', channelCount: 8, isDefault: true },
		{ handle: 'output-wasapi', label: 'Speakers', direction: 'output', channelCount: 2 },
	], { routes: {
		pair: { kind: 'device', deviceId: 'default', channelStart: 4, channelCount: 2 },
		other: { kind: 'device', deviceId: 'native:wasapi:in:other', channelStart: 30, channelCount: 2 },
		desktop: { kind: 'display', channelStart: 0, channelCount: 2 },
	} });
	try {
		await fixture.runtime.refresh();
		assert.equal(fixture.opened[0]?.channelCount, 6);
		fixture.changeRoutes({ pair: { kind: 'device', deviceId: 'default', channelStart: 4, channelCount: 2 },
			lower: { kind: 'device', deviceId: 'native:wasapi:in:input-wasapi', channelStart: 2, channelCount: 1 } });
		await fixture.runtime.settle();
		assert.equal(fixture.opened.length, 2, 'unchanged physical demand must not close a working native session');
	} finally { await fixture.runtime.dispose(); }
});

test('native route demand preserves the actual hardware capacity and existing global stereo minimum', async () => {
	const fixture = hostFixture('wasapi', false, undefined, { routes: {
		unavailable: { kind: 'device', deviceId: 'native:wasapi:in:input-wasapi', channelStart: 2, channelCount: 1 },
	} });
	try {
		await fixture.runtime.refresh();
		assert.equal(fixture.opened[0]?.channelCount, 2, 'an unavailable third plane cannot be invented on stereo hardware');
		fixture.change({ preferredInputChannelCount: 2 }); await fixture.runtime.settle();
		fixture.changeRoutes({}); await fixture.runtime.settle();
		assert.equal(fixture.opened.at(-2)?.channelCount, 2, 'removing an explicit route preserves the selected global Stereo format');
	} finally { await fixture.runtime.dispose(); }
});

test('returning to the prior native channel demand during a pending rebind still attaches the latest pin', async () => {
	const entered = deferred<void>(), release = deferred<void>();
	const fixture = hostFixture('wasapi', false, undefined, { bind: async id => {
		if (id === 'session-6') { entered.resolve(); await release.promise; }
	} });
	const pin = (channelStart: number) => ({ track: { kind: 'device' as const, deviceId: 'native:wasapi:in:input-wasapi', channelStart, channelCount: 1 } });
	try {
		await fixture.runtime.refresh();
		fixture.changeRoutes(pin(1)); await fixture.runtime.settle();
		fixture.changeRoutes(pin(0)); await entered.promise;
		fixture.changeRoutes(pin(1)); release.resolve(); await fixture.runtime.settle();
		assert.equal(fixture.opened.filter(request => request.direction === 'input').at(-1)?.channelCount, 2,
			'the old connected key cannot suppress a newer pin while its physical route is being replaced');
	} finally { release.resolve(); await fixture.runtime.dispose(); }
});

function hostFixture(host = 'electron', failOutput = false, devices?: readonly NativeAudioDeviceReport[], meter: Readonly<{
	prepareInputReplacement?: () => MicrophoneMeterInputReplacement;
	bind?: (sessionId: string) => Promise<void>;
	close?: () => void;
	context?: () => void;
	routes?: Readonly<Record<string, RecordingRoute>>;
}> = {}) {
	let settings = { host, recordingSampleRate: 96_000, preferredInputDeviceId: '',
		preferredOutputDeviceId: '', preferredInputChannelCount: 1 };
	let inventory: NativeAudioInventoryReport | null = null;
	let routes = meter.routes ?? {};
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
		getSnapshot: () => ({ audioDevices: settings, recordingInputs: { routes }, recordingScheduling: scheduled && preparingSchedule,
			scheduledRecording: scheduled && !preparingSchedule ? { startTimeMs: 100 } : null }),
		subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
		actions: { audioDevices: {
			setHostInventory: async (next, value) => { settings = { ...settings, host: next }; inventory = value; },
			requestAccess: async () => { requests += 1; },
		}, recording: { prepareInputReplacement: meter.prepareInputReplacement } },
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
		bindNativeAudioSession: async ({ sessionId }: { sessionId: string }) => { bound.push(sessionId); await meter.bind?.(sessionId); },
		closeNativeAudioSession: async ({ sessionId }: { sessionId: string }) => {
			if (failClose) throw new Error('planned close failure');
			meter.close?.();
			closed.push(sessionId); return true;
		},
	} as unknown as SoundscaperNativeServicesBridge;
	const runtime = createSoundscaperAudioHostRuntime({ controller, bridge,
		engine: { getAudioContext: async () => {
			meter.context?.();
			if (failRate) throw new Error('planned rate refusal');
			return { sampleRate: settings.recordingSampleRate } as AudioContext;
		} } });
	return { runtime, opened, described, bound, closed, settings: () => settings,
		schedule: (value: boolean, preparing = false) => { scheduled = value; preparingSchedule = preparing; },
		failClose: (value: boolean) => { failClose = value; },
		failOutput: (value: boolean) => { failOutput = value; },
		failRate: (value: boolean) => { failRate = value; },
		inventory: () => inventory, accessRequests: () => requests,
		changeRoutes: (next: Readonly<Record<string, RecordingRoute>>) => { routes = next; for (const listener of listeners) listener(); },
		change: (patch: Partial<typeof settings>) => { settings = { ...settings, ...patch }; for (const listener of listeners) listener(); },
	};
}
