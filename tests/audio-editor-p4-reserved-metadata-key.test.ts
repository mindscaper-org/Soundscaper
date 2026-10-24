/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const tag of ['$soundscaperOpaqueBinary', 'Ordinary credit']) {
	test(`metadata action preserves a literal imported custom tag ${tag}`, async context => {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.open(createSoundscaperProject({ id: 'literal-metadata' }));
		await controller.actions.metadata.update({ tags: { [tag]: 'Reviewed credit' } });
		assert.equal(controller.project?.metadata.tags[tag], 'Reviewed credit');
		await controller.actions.project.save();
		controller.actions.edit.undo();
		assert.equal(controller.project?.metadata.tags[tag], undefined);
		controller.actions.edit.redo();
		assert.equal(controller.project?.metadata.tags[tag], 'Reviewed credit');
	});
}

for (const tag of ['$soundscaperOpaqueBinary', 'OrdinaryCredit']) {
	test(`File Import and local Save retain literal TXXX description ${tag}`, async context => {
		const payload = Buffer.from(`\x03${tag}\0Reviewed credit`);
		const frame = Buffer.alloc(10); frame.write('TXXX'); frame[7] = payload.length;
		const header = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 10 + payload.length]);
		const id3 = Buffer.concat([header, frame, payload]);
		const chunk = Buffer.alloc(8 + id3.length + id3.length % 2); chunk.write('id3 '); chunk.writeUInt32LE(id3.length, 4); id3.copy(chunk, 8);
		const pcm = new Float32Array(480).fill(.25);
		const wav = Buffer.concat([Uint8Array.from(encodeWav([pcm], { sampleRate: 48_000, float: true })), chunk]);
		wav.writeUInt32LE(wav.length - 8, 4);
		const file = new File([wav], 'Credits.wav', { type: 'audio/wav' });
		const inspected = await inspectImportedMediaMetadata(file);
		assert.deepEqual(inspected.metadata.raw?.TXXX, { [tag]: 'Reviewed credit' });
		assert.deepEqual(inspected.warnings, []);
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		});
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.project.importFiles([file]);
		await controller.actions.project.save();
		assert.equal(controller.project?.clips.length, 1);
		const source = controller.project?.sources[0]; assert.ok(source);
		assert.deepEqual(normalizeSourceProvenance(source.provenance).contributions[0]?.metadata.raw.TXXX, { [tag]: 'Reviewed credit' });
		const stored: number[] = [];
		for await (const chunk of store.readSourceChunks(String(source.storageKey))) {
			const channel: unknown = chunk.channels[0]; assert.ok(channel instanceof Float32Array); stored.push(...channel);
		}
		assert.deepEqual(stored, [...pcm]);
		controller.actions.edit.undo(); assert.equal(controller.project?.clips.length, 0);
		controller.actions.edit.redo(); assert.equal(controller.project?.clips.length, 1);
		const clip = controller.project?.clips[0]; assert.ok(clip);
		controller.actions.edit.commit({ type: 'clip/remove', clipId: clip.id });
		await controller.actions.project.save();
		const saved: unknown = await store.loadProject(String(controller.project?.id));
		assert.ok(validateSoundscaperProject(saved)); assert.equal(saved.clips.length, 0);
		assert.equal(saved.featureRequirements.requirements.some(row => row.featureId === 'org.soundscaper.capability.literal-json-keys'), false);
	});
}
