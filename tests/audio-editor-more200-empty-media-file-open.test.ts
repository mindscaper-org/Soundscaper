/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { createFixture, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

test('File Open refuses empty standalone media without creating and activating a ghost project', async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = await createFixture('more200-empty-file-open', { sampleRate: 48_000,
		tracks: [{ id: 'voice', name: 'Voice', input: new Float32Array(80) }] });
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store: fixture.store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	await controller.actions.project.openById(fixture.project.id);
	const before = await fixture.store.listProjects();
	try {
		let refusal: unknown;
		try { await openWorkspaceProjectFile(controller, new File([], 'Empty take.wav', { type: 'audio/wav' }),
			() => assert.fail('audio must use the ordinary media import route')); }
		catch (error) { refusal = error; }
		assert.equal(controller.project?.id, fixture.project.id);
		assert.deepEqual(await fixture.store.listProjects(), before);
		assert.match(String(refusal), /empty/iu);
	} finally { await controller.dispose(); }
});
