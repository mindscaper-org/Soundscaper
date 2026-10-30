/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisComposition, type AnalysisCompositionState } from '../src/common/editor/controller/analysis/analysis-composition.ts';
import { createResolvedCommandProjectReader } from '../src/common/editor/controller/composition/controller-project-queries.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForCommandConsumers } from '../src/common/editor/project-current-runtime.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

for (const owned of [true, false]) test(`${owned ? 'owned' : 'generic'} analysis fingerprint preserves same-revision document branch identity`, async () => {
	const options = { id: 'analysis-work',
		sources: [{ id: 'source', storageKey: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 64 }],
		clips: Array.from({ length: 200 }, (_, index) => ({ id: `c${index}`, sourceId: 'source', sourceStartFrame: 0,
			sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: 0 })),
		tracks: Array.from({ length: 200 }, (_, index) => ({ id: `t${index}`, clipIds: [`c${index}`] })),
	};
	let project = createSoundscaperProject(options);
	const readCommand = createResolvedCommandProjectReader(() => project, projectForCommandConsumers, { immutableGenerations: true });
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const state: AnalysisCompositionState = { selectedTrackId: 't0', analysisProcessing: false, lastAnalysisRequest: null,
		contrastSelections: { foreground: null, background: null } };
	const reports = new Map<string, { rmsDbfs: number }>(), keys: string[] = [];
	const unexpected = (): never => assert.fail('A valid cached report must not render or measure PCM.');
	const actions = createAnalysisComposition({ enabled: true, productName: 'Soundscaper', state, copy: ENGLISH_COPY,
		lifetime, projectGeneration: generation, getProject: () => project, getActiveSelection: () => null,
		getImmutableProjectGeneration: owned ? readCommand : undefined, projectDurationFrames: () => 64,
		projectSampleRate: () => 48_000, cloneProject: structuredClone, hasMissingTimelineSources: () => false,
		sourceBuffers: new Map(), analyzeChannels: unexpected, renderSnapshot: unexpected,
		store: { async loadAnalysis(key) {
			keys.push(key); if (!reports.has(key)) reports.set(key, { rmsDbfs: reports.size ? -6 : -12 });
			return { result: reports.get(key), visuals: null, report: null };
		}, saveAnalysis: unexpected },
		taskProgress: createEditorTaskProgressCoordinator(), showAnalysis() {}, setStatus() {}, publish() {}, handleError: error => { throw error; } });
	const stringify = JSON.stringify;
	let serializations = 0;
	Object.defineProperty(JSON, 'stringify', { configurable: true, writable: true, value(...args: unknown[]) {
		if (args[0] === project) serializations++;
		return Reflect.apply(stringify, JSON, args) as string | undefined;
	} });
	try {
		for (let index = 0; index < 6; index++) assert.deepEqual(await actions.run(), { rmsDbfs: -12 });
		assert.equal(serializations, owned ? 1 : 6);
		assert.ok(keys.slice(0, 6).every(key => key === keys[0]));
		const previous = project;
		project = createSoundscaperProject({ ...options, title: 'Reopened branch' });
		assert.equal(project.id, previous.id); assert.equal(project.revision, previous.revision);
		generation.invalidate(); generation.activate(project.id);
		assert.deepEqual(await actions.run(), { rmsDbfs: -6 });
		assert.notEqual(keys.at(-1), keys[0]);
		assert.equal(serializations, owned ? 2 : 7);
	} finally { Object.defineProperty(JSON, 'stringify', { configurable: true, writable: true, value: stringify }); }
	lifetime.beginDisposal(); lifetime.finishDisposal();
});
