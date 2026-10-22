/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const replaceOriginals of [true, false]) test(`NP016: combined Mix and Render ${replaceOriginals ? 'protects' : 'retains'} recorded take lanes`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const sources = ['programme', 'alternate'].map(id => createAudioSource({ id, frameCount: 48, sampleRate: 48_000, channelCount: 1 }));
	for (const [index, source] of sources.entries()) {
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(48).fill(index ? .75 : .25)]); await writer.commit();
	}
	let renders = 0;
	const options = { headless: true, locale: 'en', copy: COPY, projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		renderSnapshot: () => { renders += 1; return { sampleRate: 48_000, length: 48, numberOfChannels: 2, getChannelData: () => new Float32Array(48).fill(.5) }; } };
	const controller = createAudioEditorController(null, options as unknown as Options);
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const clips = ['voice', 'music'].map(id => createAudioClip({ id: `${id}-clip`, sourceId: 'programme', durationFrames: 48, sourceDurationFrames: 48 }));
	await controller.actions.project.open(createSoundscaperProject({ id: 'mix-takes', sources, clips,
		tracks: ['voice', 'music'].map((id, index) => createAudioTrack({ id, clipIds: [clips[index]!.id] })),
		sequences: [{ id: 'main', trackIds: ['voice', 'music'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'voice', startSample: 0, endSample: 48,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: 'alternate', startSample: 0, endSample: 48, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 48 }] }] }));
	controller.actions.timeline.setExactSelection(0, 48, { trackIds: ['voice', 'music'] });
	const original: unknown = controller.project; assert.ok(validateSoundscaperProject(original));
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	let failure: unknown;
	try { await controller.actions.track.mixAndRender({ mixDown: true, renderEffects: true, replaceOriginals }); } catch (error) { failure = error; }
	const current: unknown = controller.project; assert.ok(validateSoundscaperProject(current));
	assert.deepEqual(current.takeGroups, original.takeGroups, 'a print must not erase an unflattened alternate recording');
	if (replaceOriginals) {
		assert.ok(failure instanceof Error); assert.match(failure.message, /flatten/iu); assert.equal(renders, 0);
		assert.deepEqual(current, original); assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount);
	} else {
		assert.equal(failure, undefined); assert.equal(renders, 1); assert.equal(current.tracks.length, 3);
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.takeGroups, original.takeGroups);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.takeGroups, original.takeGroups);
	}
	const retained: number[] = [];
	for await (const chunk of store.readSourceChunks(sources[1]!.storageKey)) retained.push(...chunk.channels[0].subarray(0, 3));
	assert.deepEqual(retained, [.75, .75, .75]);
});
