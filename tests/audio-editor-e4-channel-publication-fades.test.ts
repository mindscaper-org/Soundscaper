/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const operation of ['merge', 'split', 'track-resample', 'clip-resample', 'swap', 'render'] as const) {
	for (const fade of [0, 32]) test(`${operation} preserves authored edge fades ${fade}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: operation === 'render' ? 9600 : 4800,
			channelCount: operation === 'merge' ? 1 : 2 });
		const clips = (operation === 'merge' ? ['left', 'right'] : ['left']).map(id => createAudioClip({
			id: `${id}-clip`, sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800,
			...(operation === 'render' ? { sourceStartFrame: 2400, durationFrames: 2400, speedRatio: 2, linkPitchAndTempo: true } : {}),
			fadeInFrames: fade, fadeOutFrames: fade }));
		const project = createSoundscaperProject({ id: `channel-fades-${operation}-${fade}`, sources: [source], clips,
			tracks: clips.map((clip, index) => createAudioTrack({ id: index ? 'right' : 'left',
				pan: operation === 'merge' ? (index ? 1 : -1) : 0, clipIds: [clip.id] })) });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write(Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount).fill(.25)));
		await writer.commit();
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
			engine: createMemoryEngine() as unknown as Options['engine'],
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready; await controller.actions.project.open(project);
		const before = controller.project;
		if (operation === 'merge') await controller.actions.track.makeStereo('left', 'right');
		if (operation === 'split') await controller.actions.track.splitStereoLR('left');
		if (operation === 'track-resample') await controller.actions.track.resample('left', 24_000);
		if (operation === 'clip-resample') await controller.actions.clip.resample('left-clip', { sampleRate: 24_000 });
		if (operation === 'swap') await controller.actions.track.swapChannels('left');
		if (operation === 'render') await controller.actions.clip.renderPitchSpeed('left-clip');
		const after = controller.project; assert.ok(after);
		assert.equal(after.clips.length, operation === 'split' ? 2 : 1);
		for (const clip of after.clips) {
			// Make Stereo renders clip fades into the PCM; the other rewrites retain them.
			assert.equal(clip.fadeInFrames, operation === 'merge' ? 0 : fade);
			assert.equal(clip.fadeOutFrames, operation === 'merge' ? 0 : fade);
		}
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.clips, after.clips);
	});
}
