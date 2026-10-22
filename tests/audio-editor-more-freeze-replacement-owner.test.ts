/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperAudioFreezeActions } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

for (const change of ['reactivation', 'selection'] as const) test(`MP56: a pending Freeze respects ${change} ownership`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, playbackProjectService: playback,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	let release: () => void = () => undefined, entered: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	const freeze = createSoundscaperAudioFreezeActions({ store, playback }, controller, { createRenderEngine: () => ({
		loadProject() {}, async renderTrack(_id, options = {}) {
			entered(); await gate;
			return { channels: [new Float32Array(Number(options.outputFrames)).fill(0.5)] };
		}, async dispose() {} }) });
	context.after(async () => { release(); await freeze.dispose(); await controller.dispose(); playback.dispose(); }); await controller.ready;
	const source = createAudioSource({ id: `freeze-replacement-source-${change}`, frameCount: 8, channelCount: 1, sampleRate: 48_000 });
	await store.writeAudioBuffer(source.storageKey, { sampleRate: 48_000, numberOfChannels: 1, length: 8,
		getChannelData: () => new Float32Array(8).fill(0.5) }, source);
	await controller.actions.project.open(createSoundscaperProject({ id: `freeze-replacement-${change}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['take'] })],
		clips: [createAudioClip({ id: 'take', sourceId: source.id, durationFrames: 8, sourceDurationFrames: 8 })] }));
	const original = controller.project; assert.ok(original);
	await controller.actions.project.save();
	const operation = freeze.actions.freeze('voice');
	const completion = change === 'reactivation' ? assert.rejects(operation, /changed/iu) : operation;
	await started;
	const before = controller.captureProjectGeneration();
	if (change === 'reactivation') {
		await controller.actions.project.create({ title: 'Other document' });
		await controller.actions.project.openById(original.id);
	} else controller.actions.timeline.setSelection(0, 4, { trackIds: ['voice'] });
	assert.equal(controller.project?.id, original.id);
	assert.equal(controller.captureProjectGeneration().generation === before.generation, change === 'selection');
	release(); await completion;
	assert.equal(Boolean(controller.project?.tracks[0]?.audioFreeze), change === 'selection');
});
