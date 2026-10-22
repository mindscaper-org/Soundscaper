/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAudioEditorBusyBlock } from '../src/common/editor/edit-blocking.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const boundary of ['planning', 'conversion'] as const) test(`MP55: File Consolidate ${boundary} cannot publish its old report into a newly created project`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'report-source', frameCount: 8, sampleRate: 48_000, channelCount: 1 });
	await store.writeAudioBuffer(source.storageKey, { sampleRate: 48_000, numberOfChannels: 1, length: 8,
		getChannelData: () => new Float32Array(8) }, source);
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	let release: () => void = () => undefined, entered: () => void = () => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	context.after(async () => { release(); await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'consolidating', sources: [source],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['take'] })],
		clips: [createAudioClip({ id: 'take', sourceId: source.id, durationFrames: 8, sourceDurationFrames: 8 })] }));
	let held = false;
	const binding = store.getLinkedOriginalBinding.bind(store);
	const metadata = store.getSourceMetadata.bind(store);
	store.getLinkedOriginalBinding = async (projectId, sourceId) => {
		if (boundary === 'planning' && !held && projectId === 'consolidating' && sourceId === source.id) { held = true; entered(); await gate; }
		return binding(projectId, sourceId);
	};
	store.getSourceMetadata = async sourceId => {
		if (boundary === 'conversion' && !held && sourceId === source.storageKey) { held = true; entered(); await gate; }
		return metadata(sourceId);
	};
	const operation = controller.actions.media.consolidate();
	const rejected = assert.rejects(operation, /changed/u);
	await started;
	assert.equal(selectAudioEditorBusyBlock(controller.getSnapshot()).blocked, false, 'File New is admitted while consolidation plans its sources');
	await controller.actions.project.create({ title: 'New project' });
	const before = controller.getSnapshot();
	if (boundary === 'planning') assert.equal(before.deliveryReport, null);
	release(); await rejected;
	assert.equal(controller.getSnapshot().deliveryReport, before.deliveryReport);
	assert.equal(controller.getSnapshot().status, before.status);
});
