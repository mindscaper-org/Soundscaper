/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) {
	test(`native legacy AUP import preserves Unicode and PCM from ${encoding}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		const { projectFile, dataFile } = legacyAupFiles(encoding);
		await controller.actions.project.importFiles([projectFile, dataFile]);
		const project = controller.project;
		assert.ok(validateSoundscaperProject(project));
		assert.equal(project.sources.length, 1);
		assert.equal(project.tracks.find(track => track.type === 'audio')?.name, 'Voix 日本語 🎙');
		assert.equal(project.timelineAnnotations[0]?.name, 'Repère 日本語 🎵');
		const annotation = project.timelineAnnotations[0];
		assert.ok(annotation?.kind === 'region' && annotation.anchor === 'sample');
		assert.equal(annotation.startFrame, 1200);
		assert.equal(project.sources[0]?.frameCount, 4800);
		const source = project.sources[0]; assert.ok(source);
		const chunks = [];
		for await (const chunk of store.readSourceChunks(source.storageKey)) chunks.push(chunk);
		assert.equal(chunks[0]?.channels[0]?.[0], 0.25);
		assert.equal(chunks[0]?.channels[0]?.[1], -0.25);
	});
}

test('malformed BOM-marked legacy XML is refused before reading AU material', async () => {
	const { projectFile } = legacyAupFiles('utf-16le');
	const bytes = new Uint8Array(await projectFile.arrayBuffer());
	const broken = new File([bytes.subarray(0, bytes.length - 1)], projectFile.name);
	await assert.rejects(decodeLegacyAupProject(broken, []));
});
