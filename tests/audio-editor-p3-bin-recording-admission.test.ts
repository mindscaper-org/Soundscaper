/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import type { RecordingControllerFactoryOptions } from '../src/common/editor/controller/recording/recording-transaction-types.ts';
import { createAudioEditorController, createCapturePool, createFfmpegStub, createMockStream,
	createMockTrack, createProjectStore, createRecordingControllerFactory, createRecordingEngine,
} from './helpers/audio-editor-recording-controller-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const mode of ['ordinary', 'scheduled', 'read-only'] as const) test(`P3-014: Project Bin audio respects ${mode} playback admission`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'audition', sampleRate: 48_000, channelCount: 1, frameCount: 4800 });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
	const project = createSoundscaperProject({ id: 'bin-recording', sources: [source],
		projectBin: { clips: [createAudioClip({ id: 'bin-clip', sourceId: source.id, title: 'Audition', binItemId: 'bin', durationFrames: 4800, sourceDurationFrames: 4800 })] },
		tracks: [createAudioTrack({ id: 'record', name: 'Record' })] });
	await store.saveProject(project);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const contexts: MockAudioContext[] = [];
	const factory: typeof createAudioEditorEngine = (options = {}) => {
		const audio = new MockAudioContext({ sampleRate: 48_000 }); contexts.push(audio);
		return createAudioEditorEngine({ ...options, audioContextFactory: () => audio as unknown as AudioContext, offlineAudioContextFactory: null });
	};
	const created: RecordingControllerFactoryOptions[] = [];
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		async acquireProjectLock(id) { return { projectId: id, readOnly: mode === 'read-only' && id === project.id, method: 'test-lock', release() {} }; },
		engine: { ...createRecordingEngine(), getPlaybackGain: () => 1 } as unknown as Options['engine'], engineFactory: factory,
		ffmpeg: createFfmpegStub() as unknown as Options['ffmpeg'],
		recordingCapturePool: createCapturePool({ hardware: { default: createMockStream([createMockTrack('audio', { channelCount: 1 })]) } }) as unknown as Options['recordingCapturePool'],
		recordingControllerFactory: createRecordingControllerFactory(created),
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready; await controller.actions.project.openById(project.id);
	if (mode === 'read-only') {
		assert.equal(controller.getSnapshot().readOnly, true);
		await controller.actions.projectBin.playPause('bin-clip');
		assert.ok(contexts.flatMap(audio => audio.bufferSources).length > 0, 'read-only audition remains supported');
		return;
	}
	if (mode === 'scheduled') await controller.actions.recording.schedule(new Date(Date.now() + 60_000), { trackId: 'record' });
	else await controller.actions.recording.start({ trackId: 'record' });
	assert.equal(mode === 'ordinary' ? controller.getSnapshot().recording : Boolean(controller.getSnapshot().scheduledRecording), true);
	let failure: unknown;
	try { await controller.actions.projectBin.playPause('bin-clip'); } catch (error) { failure = error; }
	assert.equal(contexts.flatMap(audio => audio.bufferSources).length, 0, 'no independent audible source starts during recording');
	assert.ok(failure instanceof DOMException && failure.name === 'AbortError', String(failure));
	assert.equal(controller.getSnapshot().projectBinPreview, null);
	assert.equal(mode === 'ordinary' ? controller.getSnapshot().recording : Boolean(controller.getSnapshot().scheduledRecording), true);
	if (mode === 'scheduled') controller.actions.recording.cancelScheduled();
	await controller.actions.recording.stop();
	await controller.actions.projectBin.playPause('bin-clip');
	assert.ok(contexts.flatMap(audio => audio.bufferSources).length > 0, 'ordinary idle audition still starts its real private engine');
	assert.equal(controller.getSnapshot().projectBinPreview?.state, 'playing');
});
