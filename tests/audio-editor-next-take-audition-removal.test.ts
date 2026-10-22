/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
async function fixture(context: test.TestContext, locked = false) {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const previews: ReturnType<typeof createMemoryEngine>[] = [];
	const controller = createAudioEditorController(null, {
		headless: true, locale: 'en', copy: COPY, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store,
		engine: { ...createMemoryEngine(), getPlaybackGain: () => 1 } as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: (() => { const engine = { ...createMemoryEngine(), setPlaybackGain() {} }; previews.push(engine); return engine; }) as unknown as Options['engineFactory'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const source = createAudioSource({ id: 'take-source', storageKey: 'take-source', name: 'Take', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const writer = await store.beginSourceWrite(source.id, source);
	await writer.write([new Float32Array(48_000).fill(0.25)]); await writer.commit();
	const project = createSoundscaperProject({ id: 'take-removal', sources: [source],
		tracks: [createAudioTrack({ id: 'vocal', name: 'Vocal', clipIds: [], locked })],
		sequences: [{ id: 'main', trackIds: ['vocal'] }], primarySequenceId: 'main',
		takeGroups: ['first', 'second'].map((id, index) => ({ id, sequenceId: 'main', trackId: 'vocal',
			startSample: index * 48_000, endSample: (index + 1) * 48_000,
			laneOrder: [`lane-${id}`], lanes: [{ id: `lane-${id}` }],
			takes: [{ id: `take-${id}`, laneId: `lane-${id}`, sourceId: source.id, startSample: index * 48_000, endSample: (index + 1) * 48_000, sourceStartSample: 0 }],
			compRegions: [{ id: `region-${id}`, takeId: `take-${id}`, startSample: index * 48_000, endSample: (index + 1) * 48_000 }],
		})),
	});
	await controller.actions.project.open(project);
	return { controller, previews, groups: () => { const value: unknown = controller.project; assert.ok(validateSoundscaperProject(value)); return value.takeGroups; } };
}

for (const paused of [false, true]) test(`NP031: Remove take group retires its ${paused ? 'paused' : 'playing'} isolated audition`, async context => {
	const { controller, previews, groups } = await fixture(context);
	await controller.actions.takeComp.auditionTake('first', 'take-first');
	if (paused) await controller.actions.takeComp.auditionTake('first', 'take-first');
	controller.actions.takeComp.removeGroup('first');
	assert.deepEqual(groups().map(({ id }) => id), ['second']);
	assert.equal(previews[0]?.state, 'stopped', 'removed take media must not keep sounding after its audition controls disappear');
	controller.actions.edit.undo();
	await controller.actions.takeComp.auditionTake('first', 'take-first');
	assert.equal(previews[0]?.state, 'playing', 'Undo must start a fresh audition rather than toggle retired playback');
});

test('NP031: removing another take group preserves the current audition', async context => {
	const { controller, previews } = await fixture(context);
	await controller.actions.takeComp.auditionTake('first', 'take-first');
	controller.actions.takeComp.removeGroup('second');
	assert.equal(previews[0]?.state, 'playing');
	assert.equal((await controller.actions.takeComp.auditionTake('first', 'take-first')).state, 'paused');
});

test('NP031: a refused removal leaves the existing audition intact', async context => {
	const { controller, previews } = await fixture(context, true);
	await controller.actions.takeComp.auditionTake('first', 'take-first');
	assert.throws(() => controller.actions.takeComp.removeGroup('first'), /locked/u);
	assert.equal(previews[0]?.state, 'playing');
});
