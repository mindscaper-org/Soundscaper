/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { createRecordingRouteHistory } from '../src/common/editor/controller/composition/internal/recording-route-history.ts';
import { normalizeRecordingRouting, type RecordingRouting } from '../src/common/editor/recording-routing.js';
import { COPY } from './helpers/audio-editor-controller-harness.js';
import { createAudioEditorController, createProjectStore, createCapturePool, createMockStream, createMockTrack,
	createRecordingEngine, createRecordingControllerFactory, createFfmpegStub } from './helpers/audio-editor-recording-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
async function fixture(context: TestContext) {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection(), created: RecordingControllerFactoryOptions[] = [];
	const stream = createMockStream([createMockTrack('audio', { channelCount: 2 })]);
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en', store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createRecordingEngine() as unknown as Options['engine'], ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: createCapturePool({ hardware: { default: stream } }),
		recordingControllerFactory: createRecordingControllerFactory(created) });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const open = async (id: string) => {
		const project = createSoundscaperProject({ id, tracks: [
			createAudioTrack({ id: 'voice', name: 'Voice', armed: true, pan: .5, gain: .75 }),
			createAudioTrack({ id: 'other', name: 'Other input', armed: false }),
		] });
		const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Right.sscape'), () => 'copy');
	};
	await open('right-input');
	assert.equal(controller.getSnapshot().readOnly, false);
	const right = { kind: 'device', deviceId: 'default', deviceLabel: '', channelStart: 1, channelCount: 1 } as const;
	await controller.actions.recording.setTrackInput('voice', right);
	return { controller, store, created, right, open };
}

for (const edit of ['none', 'delete-undo', 'delete-undo-redo-undo'] as const) {
	test(`P3-016: ${edit} preserves the restored track's actual Right mono recording`, async context => {
		const { controller, store, created } = await fixture(context);
		const before = controller.project?.tracks;
		if (edit !== 'none') { controller.actions.track.remove('voice'); controller.actions.edit.undo(); }
		if (edit === 'delete-undo-redo-undo') { controller.actions.edit.redo(); controller.actions.edit.undo(); }
		assert.deepEqual(controller.project?.tracks, before, 'Undo restores the same track, gain, pan and arm state');
		await controller.actions.recording.start({ trackId: 'voice' });
		const recorder = created[0]; assert.ok(recorder);
		assert.equal(recorder.channelCount, 2, 'the physical input has two channels');
		await recorder.onChunk({ channels: [new Float32Array(128).fill(.25), new Float32Array(128).fill(-.5)] });
		await controller.actions.recording.stop();
		const source = controller.project?.sources[0]; assert.ok(source);
		const chunk = await store.readSourceChunk(source.storageKey, 0);
		assert.equal(source.channelCount, 1, 'the assigned Right input must remain mono after Undo');
		assert.deepEqual(chunk.channels.map((channel: Float32Array) => [...channel]), [Array<number>(128).fill(-.5)]);
	});
}

test('P3-016: a surviving track taking the retired channel wins over restoring its old assignment', async context => {
	const { controller } = await fixture(context);
	controller.actions.track.remove('voice');
	await controller.actions.recording.setTrackInput('other', { kind: 'device', deviceId: 'default', channelStart: 1, channelCount: 1 });
	controller.actions.edit.undo();
	const routes: unknown = controller.getSnapshot().recordingInputs.routes;
	assert.ok(routes !== null && typeof routes === 'object');
	assert.equal(Object.hasOwn(routes, 'voice'), false);
	assert.equal(Object.hasOwn(routes, 'other'), true);
});

test('P3-016: a native File Open activation cannot inherit a retired input from another project', async context => {
	const { controller, open } = await fixture(context);
	controller.actions.track.remove('voice');
	await open('incoming-unassigned');
	controller.actions.track.update('voice', { name: 'Incoming voice' });
	controller.actions.edit.undo();
	const routes: unknown = controller.getSnapshot().recordingInputs.routes;
	assert.ok(routes !== null && typeof routes === 'object');
	assert.equal(Object.hasOwn(routes, 'voice'), false);
});

test('P3-016: a later explicit user assignment survives unrelated Undo and the next track resurrection', async context => {
	const { controller } = await fixture(context);
	controller.actions.track.remove('voice'); controller.actions.edit.undo();
	await controller.actions.recording.setTrackInput('voice', { kind: 'device', deviceId: 'default', channelStart: 0, channelCount: 1 });
	controller.actions.track.update('voice', { name: 'Renamed voice' }); controller.actions.edit.undo();
	controller.actions.track.remove('voice'); controller.actions.edit.undo();
	await controller.actions.recording.start({ trackId: 'voice' });
	await controller.actions.recording.stop();
	const routes: unknown = controller.getSnapshot().recordingInputs.routes;
	assert.ok(routes !== null && typeof routes === 'object' && 'voice' in routes);
	assert.deepEqual(routes.voice, { kind: 'device', deviceId: 'default', deviceLabel: '', channelStart: 0, channelCount: 1 });
});

test('P3-016: lifetime disposal releases retired input custody', () => {
	const track = { id: 'voice', type: 'audio' }, abort = new AbortController();
	let routing: RecordingRouting = normalizeRecordingRouting({ routes: { voice: {
		kind: 'device', deviceId: 'default', channelStart: 1, channelCount: 1,
	} } }, [track]);
	const reconcile = createRecordingRouteHistory({ signal: abort.signal, getRouting: () => routing,
		setRouting: value => { routing = value; }, reconcile(tracks) {
			const next = normalizeRecordingRouting(routing, tracks);
			const changed = JSON.stringify(next) !== JSON.stringify(routing); routing = next; return changed;
		} });
	reconcile([], 1); assert.deepEqual(routing.routes, {});
	abort.abort(); reconcile([track], 1);
	assert.deepEqual(routing.routes, {});
});
