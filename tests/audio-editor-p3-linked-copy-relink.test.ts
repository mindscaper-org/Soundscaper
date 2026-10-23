/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME } from '../src/common/editor/storage/linked-original-provisional-root.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const backend of ['memory', 'indexeddb'] as const) for (const mode of ['changed', 'exact', 'refused', 'write-failed'] as const) {
	test(`duplicated linked originals keep coherent bindings after ${mode} relink in ${backend}`, async context => {
		const original = wav(.25), replacement = mode === 'changed' ? wav(-.5) : original;
		const port: LinkedOriginalPort = { load(_kind, locatorId) {
			return { blob: locatorId === 'original_locator_00001' ? original : replacement, locatorRevision: `${locatorId}_revision` };
		}, release() { return true; } };
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const store = createProjectStore({ indexedDB: indexedDB as unknown as IDBFactory | null,
			preferOpfs: false, databaseName: context.name, linkedOriginalPort: port });
		context.after(async () => { await store.close(); }); await store.ready();
		const source = createAudioSource({ id: 'linked', storageKey: 'linked', mimeType: 'audio/wav', sampleRate: 48_000,
			channelCount: 1, frameCount: 4096, chunkFrames: 65_536 });
		await store.bindLinkedAudioOriginal('project', source, 'original_locator_00001', { expectedSnapshot: original });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4096, sourceDurationFrames: 4096 });
		const project = createSoundscaperProject({ id: 'project', sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })] });
		await store.saveProject(project); const copy = await store.duplicateProject(project.id, { title: 'Copy' }); assert.ok(copy);
		const before = await Promise.all([store.getLinkedOriginalBinding(project.id, source.id), store.getLinkedOriginalBinding(copy.id, source.id)]);
		const oldCopyBinding = before[1]; assert.ok(oldCopyBinding);
		const refusal = new Error('The current project retired before publication.');
		if (mode === 'write-failed') {
			if (indexedDB) indexedDB.failNextPutForStore(LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME, refusal);
			else {
				const roots = getMemoryDatabase(context.name).linkedOriginalProvisionalRoots;
				const set = roots.set.bind(roots); let writes = 0;
				roots.set = (key, value) => { if (++writes === 2) throw refusal; return set(key, value); };
			}
		}
		const operation = store.relinkLinkedAudioOriginal(copy.id, source, 'replacement_locator_00001', {
			expectedBindingToken: oldCopyBinding.bindingToken, expectedSnapshot: replacement,
			...(mode === 'changed' ? { admission: 'changed-content' as const } : {}),
			...(mode === 'refused' ? { assertCanPublish() { throw refusal; } } : {}),
		});
		if (mode === 'changed') await assert.rejects(operation, /shared.*Import.*new media/u);
		else if ((mode === 'refused' || mode === 'write-failed')) await assert.rejects(operation, error => error === refusal);
		else await operation;
		const after = await Promise.all([store.getLinkedOriginalBinding(project.id, source.id), store.getLinkedOriginalBinding(copy.id, source.id)]);
		if (mode !== 'exact') assert.deepEqual(after, before, 'a refused operation cannot alter either project alias');
		else for (const [index, binding] of after.entries()) {
			assert.ok(binding); assert.equal(binding.locatorId, 'replacement_locator_00001');
			assert.notEqual(binding.bindingToken, before[index]?.bindingToken);
		}
		if (mode === 'exact') {
			const oldOriginalBinding = before[0]; assert.ok(oldOriginalBinding);
			await assert.rejects(store.relinkLinkedAudioOriginal(project.id, source, 'original_locator_00001', {
				expectedBindingToken: oldOriginalBinding.bindingToken, expectedSnapshot: original,
			}), /binding changed before relink/u);
			assert.deepEqual(await store.getLinkedOriginalBinding(project.id, source.id), after[0]);
		}
		const metadata = await store.getSourceMetadata(source.storageKey); assert.ok(metadata);
		const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk);
		assert.equal(chunk.channels[0]?.[0], .25, 'both project identities keep the same verified physical PCM');
		assert.deepEqual(await store.loadProject(project.id), project);
		assert.deepEqual(await store.loadProject(copy.id), copy);
	});
}

function wav(value: number): Blob {
	const bytes = encodeWav([new Float32Array(4096).fill(value)], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(bytes instanceof Uint8Array); return new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' });
}
