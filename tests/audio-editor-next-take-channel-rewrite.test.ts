/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const mode of ['split', 'merge-left', 'merge-right'] as const) test(`NP011: ${mode} channel rewrite refuses to discard unflattened takes`, async context => {
	const split = mode === 'split';
	const startSample = 9600, endSample = startSample + 4800;
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'recorded', frameCount: 4800, sampleRate: 48_000, channelCount: split ? 2 : 1 });
	const takeSource = createAudioSource({ ...source, id: 'take-source', storageKey: 'take-source' });
	for (const item of [source, takeSource]) {
		const writer = await store.beginSourceWrite(item.storageKey, item);
		await writer.write(Array.from({ length: item.channelCount }, () => new Float32Array(4800).fill(.25))); await writer.commit();
	}
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'recording', sources: [source, takeSource], tracks: [createAudioTrack({ id: 'voice', clipIds: ['material'] }), ...(!split ? [createAudioTrack({ id: 'partner', clipIds: ['partner-material'] })] : [])],
		clips: [createAudioClip({ id: 'material', sourceId: source.id, timelineStartFrame: startSample, durationFrames: 4800, sourceDurationFrames: 4800 }), ...(!split ? [createAudioClip({ id: 'partner-material', sourceId: source.id, timelineStartFrame: startSample, durationFrames: 4800, sourceDurationFrames: 4800 })] : [])],
		sequences: [{ id: 'main', trackIds: !split ? ['voice', 'partner'] : ['voice'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'group', sequenceId: 'main', trackId: mode === 'merge-right' ? 'partner' : 'voice', startSample, endSample,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: 'take-source', startSample, endSample, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample, endSample }] }] }));
	const original: unknown = controller.project; assert.ok(validateSoundscaperProject(original));
	const operation = mode === 'split' ? controller.actions.track.splitStereoLR('voice') : controller.actions.track.makeStereo('voice', 'partner');
	const error: unknown = await operation.then(() => null, (reason: unknown) => reason);
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	assert.equal(after.takeGroups.length, original.takeGroups.length, 'a channel rewrite must not erase recorded takes');
	assert.ok(error instanceof Error); assert.match(error.message, /flatten.*take|take.*flatten/iu);
	assert.deepEqual(controller.project, original, 'refusal must preserve recorded takes and the current history');
});
