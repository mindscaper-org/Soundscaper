/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

for (const format of ['aup3', 'aup4'] as const) test(`NP001: File Save ${format} reports a committed file after a later File New`, async context => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const client = createFixture().runtime.createAup4Client({});
	const savedFiles: string[] = [];
	const fileService = { isDesktop: true,
		chooseSaveTarget: async () => ({ id: 'chosen-destination' }),
		saveFile: async (request: { suggestedName: string; blob: Blob }) => {
			savedFiles.push(request.suggestedName);
			await controller.actions.project.create({ title: 'Newer project' });
			return { method: 'desktop', fileName: request.suggestedName, size: request.blob.size };
		},
	};
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, aup4Client: client,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		fileService: fileService as unknown as Options['fileService'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const originalId = controller.project?.id;
	const saved = await (format === 'aup3' ? controller.actions.project.saveAup3() : controller.actions.project.saveAup4());
	assert.ok(saved && !('cancelled' in saved));
	assert.equal(savedFiles.length, 1);
	assert.notEqual(controller.project?.id, originalId);
	assert.equal(controller.project?.title, 'Newer project');
	assert.equal(controller.getSnapshot().aup4Compatibility, null);
});
