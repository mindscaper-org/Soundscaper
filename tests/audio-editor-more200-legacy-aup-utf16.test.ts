/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readPcm } from './helpers/project-store-pcm-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) {
	test(`native legacy AUP import preserves Unicode and PCM from ${encoding}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		// Separate IndexedDB API fixtures isolate the production repositories. Real
		// browser storage and the directory chooser remain in the native BE workflow.
		const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		const archive = createSoundscaperScapeNativeRuntime();
		const controller = await constructController();
		context.after(async () => { try { await controller.dispose(); } finally { await recipient.close(); } });
		async function constructController() {
			try {
				return createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
					adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: archive,
					engine: { ...createMemoryEngine(), decodeAudioData: async () => assert.fail('Legacy AU blocks must use their production reader') } as unknown as Options['engine'],
					ffmpeg: { ...createMemoryFfmpeg(), decode: async () => assert.fail('Legacy AU blocks must not use a substitute codec') } as unknown as Options['ffmpeg'] });
			} catch (error) {
				await store.close(); await recipient.close(); throw error;
			}
		}
		await controller.ready;
		const { projectFile, dataFile } = legacyAupFiles(encoding);
		Object.defineProperty(dataFile, 'webkitRelativePath', { value: 'Été 演奏 🎙_data/e0000.au' });
		await controller.actions.project.importFiles([projectFile, dataFile]);
		await controller.actions.project.flush();
		const project = controller.project;
		assert.ok(validateSoundscaperProject(project));
		assert.equal(project.sources.length, 1);
		assert.equal(project.tracks.find(track => track.type === 'audio')?.name, 'Voix 日本語 🎙');
		assert.equal(project.timelineAnnotations[0]?.name, 'Repère 日本語 🎵');
		const annotation = project.timelineAnnotations[0];
		assert.ok(annotation?.kind === 'region' && annotation.anchor === 'sample');
		assert.equal(annotation.startFrame, 1200);
		assert.equal(annotation.endFrame, 2400);
		const source = project.sources[0]; assert.ok(source?.kind === 'audio');
		assert.deepEqual([source.frameCount, source.sampleRate, source.channelCount], [4800, 48_000, 1]);
		const expected = [Array.from({ length: 4800 }, (_, frame) => frame % 2 ? -.25 : .25)];
		assertPcmChannelsEqual(await readPcm(store, source.storageKey), expected, `${encoding} imported AU`);
		assert.deepEqual(await store.loadProject(project.id), project);
		const exported = await archive.exportScapeProject(project, store); assert.ok(exported.blob);
		const restored = await archive.importScapeProject(exported.blob, recipient);
		assert.equal(restored.readOnly, false); assert.ok(validateSoundscaperProject(restored.project));
		assert.deepEqual(restored.project, project);
		assert.deepEqual(await recipient.loadProject(project.id), project);
		const restoredSource = restored.project.sources[0]; assert.ok(restoredSource?.kind === 'audio');
		assertPcmChannelsEqual(await readPcm(recipient, restoredSource.storageKey), expected, `${encoding} portable AU`);
	});
}

test('malformed BOM-marked legacy XML is refused before reading AU material', async () => {
	const { projectFile } = legacyAupFiles('utf-16le');
	const bytes = new Uint8Array(await projectFile.arrayBuffer());
	const broken = new File([bytes.subarray(0, bytes.length - 1)], projectFile.name);
	await assert.rejects(decodeLegacyAupProject(broken, []));
});
