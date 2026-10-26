/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController } from './helpers/audio-editor-controller-harness.js';
import { createCapturePool, createMockStream, createMockTrack } from './helpers/audio-editor-recording-controller-harness.js';
import { MockAudioContext } from './helpers/mock-audio-context.js';

test('Record Pause and Resume do not restart backing audio that already finished', async (context) => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const source = createAudioSource({ id: 'backing', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const project = createSoundscaperProject({ id: 'resume-ended-backing', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'backing-track', clipIds: ['clip'] }),
			createAudioTrack({ id: 'recording-track', clipIds: [], armed: true })] });
	const audio = new MockAudioContext();
	const createBuffer = audio.createBuffer.bind(audio);
	Object.assign(audio, { createMediaStreamSource: () => audio.make('media-stream'),
		createBuffer: (...args: Parameters<typeof createBuffer>) => {
			const buffer = createBuffer(...args);
			return Object.assign(buffer, { copyToChannel: (values: Float32Array, channel: number) => buffer.getChannelData(channel).set(values) });
		} });
	const engine = createAudioEditorEngine({ audioContextFactory: () => audio as unknown as EngineAudioContext });
	const store = createMemoryStore();
	Object.assign(store, { beginSourceWrite: async () => ({ framesWritten: 0, write() {},
		commit: async () => ({}), abort: async () => {} }) });
	store.audioSources.set(source.id, [new Float32Array(48_000).fill(0.25)]);
	const stream = createMockStream([createMockTrack('audio', { channelCount: 1 })]);
	const pool = createCapturePool({ hardware: { default: stream } });
	const factory: NonNullable<Options['recordingControllerFactory']> = async options => {
		let state = 'ready';
		const publish = (next: string) => { state = next; options.onState(next); };
		return { get state() { return state; }, start() { publish('recording'); },
			startConfirmed: async schedule => { publish('recording'); return { startFrame: schedule.startFrame }; },
			rescheduleConfirmed: async schedule => ({ startFrame: schedule.startFrame }),
			pause() { publish('paused'); return true; }, resume() { publish('recording'); return true; },
			stop: async () => { publish('stopped'); }, setMonitoring() {}, setInputGain() {},
		};
	};
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store: store as unknown as Options['store'],
		engine, ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		recordingCapturePool: pool as unknown as Options['recordingCapturePool'], recordingControllerFactory: factory });
	context.after(async () => { context.mock.timers.reset(); await controller.dispose(); });
	await controller.ready; await store.saveProject(project); await controller.actions.project.open(project);
	context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
	await controller.actions.recording.start({ trackId: 'recording-track' });
	assert.equal(engine.getState().state, 'playing');
	audio.currentTime = 0.5; context.mock.timers.tick(500);
	controller.actions.recording.pause();
	assert.equal(engine.getState().state, 'paused');
	controller.actions.recording.pause();
	for (let turn = 0; turn < 30; turn++) await Promise.resolve();
	assert.equal(engine.getState().state, 'playing', 'an interrupted backing run still resumes normally');
	audio.currentTime = 35; context.mock.timers.tick(35_000);
	for (let turn = 0; turn < 10; turn++) await Promise.resolve();
	assert.equal(engine.getState().state, 'stopped');
	assert.equal(controller.getSnapshot().recording, true);
	const audibleSources = audio.bufferSources.length;
	controller.actions.recording.pause();
	controller.actions.recording.pause();
	for (let turn = 0; turn < 30; turn++) await Promise.resolve();
	assert.equal(audio.bufferSources.length, audibleSources, 'resuming capture must not schedule the old backing clip again');
	assert.equal(engine.getState().state, 'stopped');
	assert.equal(controller.getSnapshot().transportState, 'recording');
});
