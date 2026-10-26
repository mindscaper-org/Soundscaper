/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createTimedRecordingInputService, type TimedRecordingInputServiceRuntime } from '../src/common/editor/controller/recording/internal/timed-recording-input-service.ts';
import { planRoutedRecordingSources } from '../src/common/editor/controller/recording/internal/routed-recording-source-plan.ts';
import { snapshotTakeCycleRoutedRoutes } from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-routed-capture-validation.ts';
import { normalizeRecordingRouting, recordingRouteSourceKey, recordingChannelOptions, recordingRoutingSettingKey, setRecordingTrackRoute } from '../src/common/editor/recording-routing.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const trackId of ['__proto__', 'constructor', 'toString', 'voice']) {
	test(`P3-009: native track ${trackId} retains its stored recording assignment`, async context => {
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const runtime = createSoundscaperProjectRuntimeSelection();
		const project = createSoundscaperProject({ id: `routing-${trackId}`, tracks: [createAudioTrack({ id: trackId, name: 'Voice' })] });
		const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Routes.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		const openedId = controller.project?.id; assert.ok(openedId);
		const route = { kind: 'device', deviceId: 'interface', deviceLabel: 'Studio interface', channelStart: 2, channelCount: 1 } as const;
		const saved = { routes: Object.fromEntries([[trackId, route]]), offsets: { 'device:interface': 12.5 } };
		assert.deepEqual(await controller.actions.recording.setTrackInput(trackId, route), route);
		await controller.actions.recording.setSourceOffset('device:interface', 12.5);
		assert.deepEqual(await store.loadSetting(recordingRoutingSettingKey(openedId)), saved);
		await controller.actions.project.create();
		await controller.actions.project.openById(openedId);
		const routing: unknown = controller.getSnapshot().recordingInputs;
		assert.ok(record(routing) && record(routing.routes));
		assert.deepEqual(Object.keys(routing.routes), [trackId], 'reopening must retain the exact assigned track identity');
		assert.deepEqual(routing.routes[trackId], route);
		assert.deepEqual(routing.offsets, saved.offsets);
		assert.equal(Object.getPrototypeOf(routing.routes), Object.prototype);
	});
}

test('P3-009: inherited dictionary names are not implicit recording assignments', () => {
	for (const id of ['__proto__', 'constructor', 'toString']) {
		const routing = normalizeRecordingRouting({}, [{ id, type: 'audio' }]);
		assert.deepEqual(Object.keys(routing.routes), []);
		assert.deepEqual(recordingChannelOptions({ id, type: 'audio' }, 1, routing.routes), [
			{ channelStart: 0, channelCount: 1, disabled: false },
		]);
		const route = { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 };
		const assigned = setRecordingTrackRoute(routing, { id, type: 'audio' }, route);
		assert.deepEqual(Object.keys(assigned.routes), [id]);
		assert.deepEqual(assigned.routes[id], { ...route, deviceLabel: '' });
		assert.deepEqual(Object.keys(setRecordingTrackRoute(assigned, { id, type: 'audio' }, null).routes), []);
	}
});

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

test('P3-009: ordinary and cycle recording planners retain own routes and skip inherited names', () => {
	for (const id of ['__proto__', 'constructor', 'toString', 'voice']) {
		const tracks = [{ id, type: 'audio', armed: true }];
		const route = { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 } as const;
		const unassigned = planRoutedRecordingSources(tracks, {}, recordingRouteSourceKey);
		assert.deepEqual(unassigned.assigned, []); assert.deepEqual(unassigned.skippedTrackIds, [id]);
		const own = Object.fromEntries([[id, route]]);
		assert.equal(planRoutedRecordingSources(tracks, own, recordingRouteSourceKey).assigned[0]?.route, route);
		const snapshot = snapshotTakeCycleRoutedRoutes(own, tracks);
		assert.deepEqual(Object.keys(snapshot), [id]); assert.deepEqual(snapshot[id], { ...route, deviceLabel: '' });
	}
});

test('P3-009: timer acquisition never treats an inherited route name as a configured input', async () => {
	for (const id of ['__proto__', 'constructor', 'toString', 'voice']) {
		const project = { tracks: [{ id, type: 'audio', armed: true }] };
		const acquired: Readonly<{ deviceId: string; channelCount: number }>[] = [];
		const runtime: TimedRecordingInputServiceRuntime<object> = {
			getProject: () => project, findTrack: (target, trackId) => target.tracks.find(track => track.id === trackId) ?? null,
			projectSampleRate: () => 48_000, getPreferredInputChannelCount: () => 1, getRecordingRoutes: () => ({}),
			setRecordingRouteHealth() {}, defaultDeviceId: 'default', recordingRouteSourceKey,
			streamAudioChannelCount: () => 1, recordingStreamIsLive: () => true,
			capturePool: { acquireDisplay: () => ({}), acquireHardware: (deviceId, request) => { acquired.push({ deviceId, channelCount: request.channelCount }); return {}; } },
			messages: { armTrack: 'Arm a track.', assignInput: 'Assign an input.', preparedInputClosed: 'Input closed.', assignedInputsUnavailable: 'Input unavailable.' },
		};
		const service = createTimedRecordingInputService(runtime); const scope = { assertCurrent() {} };
		await service.prepareTimedRecordingInputs({ trackId: id }, scope);
		assert.deepEqual(acquired, [{ deviceId: 'default', channelCount: 1 }]); acquired.length = 0;
		await assert.rejects(service.prepareTimedRecordingInputs({}, scope), /Assign an input/u);
		assert.deepEqual(acquired, []);
	}
});
