/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { EngineProject } from '../src/common/editor/engine/types.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const paused of [false, true]) test(`MP63: opening an OS-delivered native project retires a ${paused ? 'paused' : 'playing'} take audition`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `take-preview-lifetime-${String(paused)}` });
	const previews: { state: string; readonly loadedProjects: EngineProject[] }[] = [];
	const createPreviewEngine = () => {
		const loadedProjects: EngineProject[] = [];
		const engine = { ...createMemoryEngine(), loadedProjects,
			loadProject(value: EngineProject) { loadedProjects.push(structuredClone(value)); }, setPlaybackGain() {} };
		previews.push(engine); return engine;
	};
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: { ...createMemoryEngine(), getPlaybackGain: () => 1 } as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: createPreviewEngine as unknown as Options['engineFactory'],
	});
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const source = createAudioSource({ id: 'take-source', storageKey: 'take-source', name: 'Take', frameCount: 48_000, channelCount: 1, sampleRate: 48_000 });
	const writer = await store.beginSourceWrite(source.id, source); await writer.write([new Float32Array(48_000).fill(0.25)]); await writer.commit();
	const project = createSoundscaperProject({ id: 'take-preview-owner', sources: [source],
		tracks: [createAudioTrack({ id: 'vocal', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'main', trackIds: ['vocal'] }], primarySequenceId: 'main',
		takeGroups: [{ id: 'group', sequenceId: 'main', trackId: 'vocal', startSample: 0, endSample: 48_000,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }],
			takes: [{ id: 'take', laneId: 'lane', sourceId: source.id, startSample: 0, endSample: 48_000, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 48_000 }] }] });
	await controller.actions.project.open(project);
	await controller.actions.takeComp.auditionTake('group', 'take');
	assert.equal(previews[0]?.state, 'playing');
	if (paused) { await controller.actions.takeComp.auditionTake('group', 'take'); assert.equal(previews[0]?.state, 'paused'); }
	const incoming = createSoundscaperProject({ ...project, id: 'incoming-project', sources: [{ ...source, name: 'Incoming Take' }] });
	const archive = await exportScapeProject(incoming, store);
	assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Incoming.sscape'), () => 'copy');
	assert.notEqual(controller.project?.id, project.id);
	assert.equal(previews[0]?.state, 'stopped', 'outgoing take audio must not continue underneath the new document');
	await controller.actions.takeComp.auditionTake('group', 'take');
	assert.equal(previews[0]?.state, 'playing');
	assert.equal(previews[0]?.loadedProjects.length, 2, 'reused take identities must load the incoming document rather than toggle the old preview');
	const previewSource = previews[0]?.loadedProjects.at(-1)?.sources?.[0];
	assert.ok(previewSource && 'name' in previewSource);
	assert.equal(previewSource.name, 'Incoming Take');
});
