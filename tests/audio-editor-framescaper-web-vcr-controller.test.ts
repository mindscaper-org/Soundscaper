/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { harness, hostSnapshot, tick, deferred } from './helpers/web-vcr-controller-fixture.ts';

test('Web VCR stays fail-closed behind the roadmap capability gate', async () => {
	const fixture = harness({ enabled: false });
	await fixture.controller.initialize();
	assert.equal(fixture.calls.includes('handshake'), false);
	assert.deepEqual(fixture.controller.snapshot.capability,
		{ status: 'unavailable', reason: 'roadmap-gate' });
	assert.equal(fixture.controller.snapshot.autoStop, false);
	await assert.rejects(() => fixture.controller.actions.activate(), /unavailable/iu);
});

test('activation releases device preview and opens one owned display plus page-audio preview', async () => {
	const fixture = harness();
	fixture.capture.state.phase = 'previewing';
	fixture.capture.state.sources = [{ sourceId: 'device-source', role: 'microphone' }];
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	assert.deepEqual(fixture.calls, [
		'handshake', 'subscribe', 'release', 'select:web-vcr', 'show-panel', 'open:1080p',
		'preview:display,system-audio',
	]);
	assert.equal(fixture.controller.snapshot.modeActive, true);
	assert.equal(fixture.controller.snapshot.phase, 'ready');
	assert.deepEqual(fixture.controller.snapshot.availableResolutions, ['720p', '1080p']);
	assert.equal(fixture.controller.snapshot.navigation.loading, false);
	assert.equal(fixture.controller.snapshot.previewStream, fixture.previewStream);
});

test('record freezes crop and shared destination, and record/stop are single-flight', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const first = fixture.controller.actions.record();
	const second = fixture.controller.actions.record();
	assert.equal(first, second);
	await first;
	assert.deepEqual(fixture.frozenCrops, [{ x: 0.1, y: 0.2, width: 0.6, height: 0.5 }]);
	assert.deepEqual(fixture.arms, [{ destination: 'timeline', countdownMs: 5_000 }]);
	assert.equal(fixture.calls.filter((entry) => entry === 'start').length, 1);
	assert.ok(fixture.calls.indexOf('host:preparing') < fixture.calls.indexOf('start'));
	assert.ok(fixture.calls.indexOf('start') < fixture.calls.indexOf('host:recording'));
	const stopA = fixture.controller.actions.stopAndImport();
	const stopB = fixture.controller.actions.stopAndImport();
	assert.equal(stopA, stopB);
	await stopA;
	assert.equal(fixture.calls.filter((entry) => entry === 'stop').length, 1);
	assert.ok(fixture.calls.indexOf('host:finalizing') < fixture.calls.indexOf('stop'));
	assert.ok(fixture.calls.indexOf('stop') < fixture.calls.lastIndexOf('host:ready'));
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	fixture.capture.state.phase = 'recording';
	await fixture.controller.actions.close();
	assert.equal(fixture.calls.includes('dispatch:set-visibility'), true);
	assert.equal(fixture.calls.includes('dispose'), false);
});

test('navigation or target loss seals active work into recovery while exact ended auto-stops', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	fixture.capture.state.phase = 'recording';
	fixture.publish(hostSnapshot({ navigation: { generation: 2 } }));
	await tick();
	assert.equal(fixture.calls.includes('seal'), true);

	const ended = harness();
	await ended.controller.initialize();
	await ended.controller.actions.activate();
	await ended.controller.actions.record();
	ended.capture.state.phase = 'recording';
	ended.publish(hostSnapshot({ phase: 'recording', autoStop: true,
		target: { mediaState: 'ended' }, targetEndedRecordingToken: 'c'.repeat(32) }));
	await tick();
	assert.equal(ended.calls.includes('stop'), false);
	ended.publish(hostSnapshot({ phase: 'recording', autoStop: true,
		target: { mediaState: 'ended' }, targetEndedRecordingToken: ended.recordingTokens[0] }));
	await tick();
	assert.equal(ended.calls.includes('stop'), true);

	const recovered = harness();
	await recovered.controller.initialize();
	await recovered.controller.actions.activate();
	await recovered.controller.actions.record();
	recovered.capture.state.phase = 'recording';
	recovered.publish(hostSnapshot({ phase: 'recovery' }));
	await tick();
	assert.equal(recovered.calls.includes('seal'), true);
});

test('Web VCR recovery ownership restores the opt-in mode without opening a guest', async () => {
	const fixture = harness();
	fixture.capture.state.phase = 'recovery';
	fixture.capture.state.sources = [
		{ sourceId: 'web-vcr:opaque-source', role: 'display' },
		{ sourceId: 'web-vcr:page-audio', role: 'system-audio' },
	];
	await fixture.controller.initialize();
	assert.equal(fixture.controller.snapshot.modeActive, true);
	assert.equal(fixture.controller.snapshot.phase, 'recovery');
	assert.equal(fixture.calls.includes('open:1080p'), false);
	fixture.capture.state.phase = 'inactive';
	fixture.capture.state.sources = [];
	fixture.controller.synchronizeCapture();
	await tick();
	assert.equal(fixture.controller.snapshot.modeActive, false);
	assert.equal(fixture.calls.includes('select:devices'), true);
});

test('manual crop records without a selected page target', async () => {
	const fixture = harness({ host: hostSnapshot({ autoCrop: false, target: null }) });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	assert.equal(fixture.calls.includes('start'), true);
});

test('Record rejects an exact target that already ended', async () => {
	const fixture = harness({ host: hostSnapshot({ target: { mediaState: 'ended' } }) });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /already ended/iu);
	assert.equal(fixture.calls.includes('host:preparing'), false);
});

test('manual aspect selection constrains the encoded physical crop immediately', async () => {
	const fixture = harness({ host: hostSnapshot({ autoCrop: false, crop: { x: 0, y: 0, width: 1, height: 1 } }) });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.setAspect('9:16');
	const command = fixture.commands.find((value) => value.kind === 'set-crop');
	assert.deepEqual(command && 'crop' in command ? command.crop : null, {
		x: 0.341796875, y: 0, width: 0.31640625, height: 1,
	});
	await fixture.controller.actions.record();
	fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 }, outputSize: { width: 608, height: 1_080 },
	});
});

test('automatic crop rejects manual aspect and crop mutations', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.setAspect('1:1'), /automatic crop/iu);
	await assert.rejects(() => fixture.controller.actions.setCrop({ x: 0, y: 0, width: 0.5, height: 0.5 }), /automatic crop/iu);
	assert.equal(fixture.commands.some((value) => value.kind === 'set-crop'), false);
});

test('manual crop cannot record while top-level navigation is unsettled', async () => {
	const fixture = harness({ host: hostSnapshot({ autoCrop: false, navigation: { isLoading: true } }) });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /not ready/iu);
	assert.equal(fixture.calls.includes('host:preparing'), false);
});

test('a rejected preparing transition clears frozen frame authority', async () => {
	const fixture = harness({ rejectHostState: 'preparing' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /preparing rejected/iu);
	assert.equal(fixture.calls.includes('start'), false);
	assert.throws(() => fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_152, height: 540 },
	}), /frozen capture surface/iu);
});

test('the local take fence locks browser controls while desktop acknowledges preparing', async () => {
	const preparingGate = deferred<void>();
	const fixture = harness({ preparingGate: preparingGate.promise });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const recording = fixture.controller.actions.record();
	await tick();
	assert.equal(fixture.controller.snapshot.phase, 'preparing');
	assert.throws(() => fixture.controller.actions.setAutoStop(true), /locked/iu);
	preparingGate.resolve();
	await recording;
});

test('record reserves the app origin and shared destination before asynchronous desktop preparation', async () => {
	const admissionGate = deferred<void>();
	const fixture = harness({ admissionGate: admissionGate.promise });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const recording = fixture.controller.actions.record();
	fixture.capture.state.setupDefaults = { destination: 'project-bin', countdownMs: 0 };
	await tick();
	assert.deepEqual(fixture.calls.slice(-2), ['admission:begin', 'admission:prepare']);
	assert.equal(fixture.calls.includes('host:preparing'), false);
	admissionGate.resolve();
	await recording;
	assert.deepEqual(fixture.arms, [{ destination: 'timeline', countdownMs: 5_000 }]);
	assert.ok(fixture.calls.indexOf('admission:prepare') < fixture.calls.indexOf('host:preparing'));
	assert.ok(fixture.calls.indexOf('start') < fixture.calls.indexOf('admission:release'));
});

test('app start-admission failure releases the origin without mutating desktop capture state', async () => {
	const fixture = harness({ admissionFailure: new Error('project flush failed') });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /project flush failed/iu);
	assert.equal(fixture.calls.includes('host:preparing'), false);
	assert.equal(fixture.calls.includes('host:recovery'), false);
	assert.equal(fixture.calls.filter((entry) => entry === 'admission:release').length, 1);
});

test('a target aperture change during app admission aborts before desktop or shared capture starts', async () => {
	const admissionGate = deferred<void>();
	const fixture = harness({ admissionGate: admissionGate.promise });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const recording = fixture.controller.actions.record();
	fixture.publish(hostSnapshot({
		crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
		target: { aperture: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } },
	}));
	admissionGate.resolve();
	await assert.rejects(recording, /authority changed during start admission/iu);
	assert.equal(fixture.calls.includes('host:preparing'), false);
	assert.equal(fixture.calls.includes('arm'), false);
	assert.equal(fixture.calls.includes('start'), false);
	assert.equal(fixture.calls.filter((entry) => entry === 'admission:release').length, 1);
});

test('a rejected host recording transition seals the already-started shared take', async () => {
	const fixture = harness({ rejectHostState: 'recording' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record(), /recording rejected/iu);
	assert.equal(fixture.calls.filter((entry) => entry === 'seal').length, 1);
	assert.equal(fixture.capture.state.phase, 'recovery');
	assert.throws(() => fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_152, height: 540 },
	}), /frozen capture surface/iu);
});

test('a rejected host recovery does not poison a later real recovery transition', async () => {
	const fixture = harness({ rejectHostState: 'preparing', rejectHostStateOnce: 'recovery' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.record());
	fixture.capture.state.phase = 'recording';
	fixture.capture.state.sources = [
		{ sourceId: 'web-vcr:display', role: 'display' },
		{ sourceId: 'web-vcr:page-audio', role: 'system-audio' },
	];
	await fixture.controller.sealForShutdown();
	assert.equal(fixture.calls.filter((entry) => entry === 'host:recovery').length, 2);
});

test('a panel hidden during capture drops the destroyed guest and reopens a fresh session', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	fixture.capture.state.phase = 'recording';
	await fixture.controller.actions.close();
	await fixture.controller.actions.stopAndImport();
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 1);
	assert.equal(fixture.controller.snapshot.modeActive, false);
	await fixture.controller.actions.activate();
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	assert.equal(fixture.calls.filter((entry) => entry === 'open:1080p').length, 2);
	assert.equal(fixture.calls.filter((entry) => entry === 'dispatch:set-visibility').length, 1);
});

test('delayed desktop snapshots cannot replace or close a newer guest generation', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	fixture.publish(hostSnapshot({ sessionId: 'f'.repeat(32), generation: 2, resolution: '720p', captureSurface: { width: 1280, height: 720 } }));
	fixture.publish(hostSnapshot());
	fixture.publish(hostSnapshot({ sessionId: null, generation: 1, phase: 'closed', visible: false, target: null }));
	assert.deepEqual(fixture.controller.captureAuthority.captureSurface(), { width: 1280, height: 720 });
	assert.equal(fixture.controller.snapshot.modeActive, true);
	fixture.publish(hostSnapshot({ sessionId: null, generation: 2, phase: 'closed', visible: false, target: null }));
	await tick();
	assert.equal(fixture.controller.snapshot.modeActive, false);
});

test('stop during the shared countdown never publishes a late recording transition', async () => {
	const startGate = deferred<void>();
	const fixture = harness({ startGate: startGate.promise });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	const recording = fixture.controller.actions.record();
	await tick();
	assert.equal(fixture.capture.state.phase, 'countdown');
	const stopping = fixture.controller.actions.stopAndImport();
	startGate.resolve();
	await Promise.all([recording, stopping]);
	assert.equal(fixture.calls.includes('host:recording'), false);
	assert.deepEqual(fixture.calls.filter((entry) => entry.startsWith('host:')), [
		'host:preparing', 'host:finalizing', 'host:ready',
	]);
});

test('a rejected host finalizing transition cannot strand the shared capture', async () => {
	const fixture = harness({ rejectHostState: 'finalizing' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	fixture.capture.state.phase = 'recording';
	await assert.rejects(() => fixture.controller.actions.stopAndImport(), /finalizing rejected/iu);
	assert.equal(fixture.calls.filter((entry) => entry === 'stop').length, 1);
	assert.equal(fixture.capture.state.phase, 'previewing');
	assert.equal(fixture.calls.includes('host:recovery'), true);
	assert.throws(() => fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_152, height: 540 },
	}), /frozen capture surface/iu);
});

test('first encoded frame must match the frozen host surface and even crop', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.record();
	assert.throws(() => fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_280, height: 720 },
		outputSize: { width: 768, height: 360 },
	}), /frozen capture surface/iu);
	fixture.controller.captureAuthority.reportDimensions({
		inputSize: { width: 1_920, height: 1_080 },
		outputSize: { width: 1_152, height: 540 },
	});
});

test('resolution changes and destructive data clear reacquire a fresh owned preview', async () => {
	const fixture = harness();
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await fixture.controller.actions.setResolution('720p');
	assert.equal(fixture.controller.snapshot.resolution, '720p');
	assert.deepEqual(fixture.controller.snapshot.surface, { width: 1_280, height: 720 });
	assert.equal(fixture.calls.filter((entry) => entry === 'release').length, 1);
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	await fixture.controller.actions.clearBrowserData();
	assert.equal(fixture.controller.snapshot.navigation.url, 'about:blank');
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 3);
});

test('browser-data confirmation failure restores preview and preserves the primary error', async () => {
	const fixture = harness({ dispatchFailure: 'request-data-clear' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.clearBrowserData(), /request-data-clear failed/iu);
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	assert.equal(fixture.calls.filter((entry) => entry === 'open:1080p').length, 1);
});

test('destructive browser-data failure reopens before preview and preserves the primary error', async () => {
	const fixture = harness({ dispatchFailure: 'clear-browser-data' });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.clearBrowserData(), /clear-browser-data failed/iu);
	assert.equal(fixture.calls.filter((entry) => entry === 'open:1080p').length, 2);
	assert.equal(fixture.calls.filter((entry) => entry === 'preview:display,system-audio').length, 2);
	assert.equal(fixture.controller.snapshot.modeActive, true);
});

test('failed browser-data recovery never masks the primary destructive error', async () => {
	const fixture = harness({ dispatchFailure: 'clear-browser-data', rejectReopen: true });
	await fixture.controller.initialize();
	await fixture.controller.actions.activate();
	await assert.rejects(() => fixture.controller.actions.clearBrowserData(), /clear-browser-data failed/iu);
	assert.equal(fixture.warnings.some((value) => value.includes('reopen failed')), true);
});
