/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadNyquistWasm } from '../src/common/editor/nyquist/runtime.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioEditorController, createMemoryEngine, createFixture, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';

test('a real opened label-only Scape routes shipping Nyquist output to its focused sequence without rendering', async context => {
	const evaluator = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	let nativeAudioAccesses = 0;
	const forbidNativeAudio = () => { nativeAudioAccesses += 1; throw new Error('The exact label-only path must not decode, allocate or render native audio.'); };
	const engine = { ...createMemoryEngine(), decodeAudioData: async () => forbidNativeAudio(), getAudioContext: async () => forbidNativeAudio() };
	let evaluations = 0;
	const native = createSoundscaperScapeNativeRuntime();
	const { controller, store } = await controllerSession(context, { scapeProjectRuntime: native, engine: engine as unknown as Options['engine'],
		engineFactory: forbidNativeAudio,
		nyquistEvaluator: (request: Parameters<typeof evaluator.evaluate>[0]) => {
			evaluations += 1;
			const result = evaluator.evaluate(request);
			assert.equal(result.type, 'labels');
			assert.deepEqual(result.labels, [{ start: .1, end: .2, text: 'Speech' }]);
			return Promise.resolve(result);
		},
	});
	const original = createSoundscaperProject({ id: 'nyquist-label-sequence', title: 'Two sequences', primarySequenceId: 'main',
		sequences: [{ id: 'other', trackIds: ['hidden-labels'] }, { id: 'main', trackIds: ['visible-labels'] }],
		tracks: [{ id: 'hidden-labels', type: 'label', name: 'Hidden labels', labels: [] },
			{ id: 'visible-labels', type: 'label', name: 'Visible labels', labels: [] }],
	});
	const exported = await native.exportScapeProject(original, store); assert.ok(exported.blob);
	await controller.actions.project.openScapeFile(new File([exported.blob], 'two-sequences.sscape'), () => 'copy');
	const admitted = clipboardProject(controller.project);
	assert.deepEqual(clipboardDocument(admitted), clipboardDocument(original));
	assert.equal(admitted.sampleRate, 48_000); assert.equal(admitted.sources.length, 0);
	controller.actions.timeline.selectTrack('visible-labels');
	const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	await controller.actions.nyquist.evaluate({ source: "'((0.1 0.2 \"Speech\"))", role: 'prompt' });
	assert.equal(evaluations, 1, 'the actual shipping WASM evaluates this prompt once');
	assert.equal(nativeAudioAccesses, 0, 'the label-only shipping path never opens a decoder, AudioContext or renderer');
	const after = clipboardProject(controller.project), labels = after.tracks.find(track => track.id === 'visible-labels')?.labels;
	assert.ok(Array.isArray(labels)); assert.equal(labels.length, 1);
	const label: unknown = labels[0]; assert.ok(label && typeof label === 'object' && 'id' in label && typeof label.id === 'string');
	assert.deepEqual(label, { id: label.id, title: 'Speech', startFrame: 4800, endFrame: 9600,
		color: 'auto', opaqueExtensions: {}, anchor: 'sample', startBeat: null, endBeat: null });
	assert.deepEqual(clipboardDocument(after), { ...clipboardDocument(before), tracks: before.tracks.map(track => track.id === 'visible-labels' ? { ...track, labels: [label] } : track) });
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after));
	await controller.actions.project.flush();
	const reopened = await assertEditedAudioArchiveCustody(context, store, controller.project, []);
	assert.deepEqual(clipboardDocument(reopened), clipboardDocument(after));
	assert.equal(nativeAudioAccesses, 0);
});

for (const scenario of ['another-sequence', 'locked', 'explicit-label', 'fallback'] as const) test(`Nyquist label destination honors ${scenario}`, async () => {
	const locked = scenario === 'locked';
	const newPeer = scenario === 'fallback';
	const input = new Float32Array(8_000);
	const { store, project } = await createFixture('nyquist-label-target', { sampleRate: 8_000,
		tracks: [{ id: 'voice', name: 'Voice', input }] });
	await store.saveProject(createSoundscaperProject({ id: project.id, title: project.title, sampleRate: project.sampleRate, sources: project.sources, clips: project.clips,
		primarySequenceId: 'visible', sequences: [
			{ id: 'other', rate: { num: 25, den: 1 }, trackIds: newPeer ? ['voice'] : locked ? [] : ['other-labels'] },
			{ id: 'visible', rate: { num: 25, den: 1 }, trackIds: newPeer ? ['other-labels', 'visible-labels'] : locked ? ['other-labels', 'voice', 'visible-labels'] : ['voice', 'visible-labels'] },
		], tracks: [
			...(newPeer ? project.tracks : []),
			{ id: 'other-labels', type: 'label', locked: locked || newPeer, labels: [] },
			...(newPeer ? [] : project.tracks),
			{ id: 'visible-labels', type: 'label', labels: [] },
		],
	}));
	const runtime = await loadNyquistWasm(readFileSync(new URL('../src/common/editor/nyquist/nyquist.wasm', import.meta.url)));
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const options = { headless: true, productId: 'soundscaper', copy: ENGLISH_COPY, locale: 'en',
		store, projectRuntime, sessionController: projectRuntime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: { dispose() {} } as unknown as Options['ffmpeg'],
		nyquistEvaluator: (request: Parameters<typeof runtime.evaluate>[0]) => Promise.resolve(runtime.evaluate(request)),
		renderSnapshot: async () => ({ length: input.length, sampleRate: 8_000, numberOfChannels: 1, getChannelData: () => input }),
	};
	const controller = createAudioEditorController(null, options);
	await controller.ready; await controller.actions.project.openById(project.id);
	try {
		controller.actions.timeline.selectTrack('voice');
		controller.actions.timeline.setSelection(0, input.length, { trackIds: ['voice'], clipIds: [] });
		if (scenario === 'explicit-label') controller.actions.timeline.selectTrack('other-labels');
		await controller.actions.nyquist.evaluate({ source: "'((0.1 0.2 \"Speech\"))", role: 'prompt' });
		const tracks = controller.getSnapshot().project?.tracks as readonly Readonly<{ id: string; labels?: readonly unknown[] }>[] | undefined;
		assert.ok(tracks);
		assert.equal(tracks.find(track => track.id === 'visible-labels')?.labels?.length, scenario === 'explicit-label' ? 0 : 1);
		assert.equal(tracks.find(track => track.id === 'other-labels')?.labels?.length, scenario === 'explicit-label' ? 1 : 0);
	} finally { await controller.dispose(); }
});
