/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';

for (const content of ['labels', 'annotations'] as const) test(`closing a restored unsaved ${content}-only project asks before closing`, async t => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const prompts: unknown[] = [];
	const store = createMemoryStore();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: store as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		fileService: createAudioEditorFileService({ bridge: {
			restoreProjectFile: async () => null,
			confirmProjectSave: async (request: unknown) => { prompts.push(request); return 'cancel'; },
		} }),
	});
	t.after(async () => { await controller.dispose(); });
	await controller.ready;
	assert.equal(await controller.actions.project.prepareClose(), true, 'the untouched startup project stays quiet');
	const restored = createCurrentAudioEditorProject({ id: `unsaved-${content}`, title: 'Unsaved cues',
		tracks: content === 'labels' ? [createLabelTrack({ id: 'labels', labels: [{ id: 'cue', title: 'Keep this cue', startFrame: 48000, endFrame: 96000 }] })] : [],
		sequences: [{ id: 'main', trackIds: content === 'labels' ? ['labels'] : [] }], primarySequenceId: 'main',
		timelineAnnotations: content === 'annotations' ? [{ id: 'cue', sequenceId: 'main', name: 'Keep this cue',
			color: 'auto', batchId: null, opaqueExtensions: {}, kind: 'marker', anchor: 'sample', positionFrame: 48000 }] : [],
	});
	await store.saveProject(restored);
	await controller.actions.project.open(restored);
	assert.equal(await controller.actions.project.prepareClose(), false, 'Cancel retains the reopened authoring document');
	assert.equal(prompts.length, 1);
});
