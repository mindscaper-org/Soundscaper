/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { consolidateProjectMedia } from '../src/common/editor/controller/document/consolidate-media-service.ts';
import { loadWavPackWasm, encodePcmAdaptively, decodePcmWithWavPack } from '../src/common/editor/wavpack/index.js';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const mode of ['changed', 'exact', 'read-failed', 'unconsolidated'] as const) test(`linked original ${mode} Relink preserves immutable consolidated copies`, async context => {
	const runtime = await loadWavPackWasm(await readFile(new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url)));
	const codec = {
		async encode(input: ArrayBuffer, options: Record<string, unknown>) { return encodePcmAdaptively(input, { ...options, runtime }); },
		async decode(input: ArrayBuffer, options: Record<string, unknown>) { return { payload: decodePcmWithWavPack(input, { ...options, runtime }) }; },
	};
	const original = wav(.25), replacement = mode === 'exact' || mode === 'read-failed' ? original : wav(-.5);
	const port: LinkedOriginalPort = { load(_kind, locatorId) {
		return { blob: locatorId === 'original_locator_00001' ? original : replacement, locatorRevision: `${locatorId}_revision` };
	}, release() { return true; } };
	const indexedDB = createInstrumentedIndexedDB();
	const store = createProjectStore({ indexedDB: indexedDB as unknown as IDBFactory, memoryFallback: false,
		preferOpfs: false, databaseName: context.name, pcmCodec: codec, linkedOriginalPort: port });
	context.after(async () => { await store.close(); }); await store.ready();
	const source = createAudioSource({ id: 'linked', storageKey: 'linked', sampleRate: 48_000, frameCount: 4096, channelCount: 1, mimeType: 'audio/wav' });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4096, sourceDurationFrames: 4096 });
	const project = createSoundscaperProject({ id: 'original', sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	await store.bindLinkedAudioOriginal(project.id, source, 'original_locator_00001', { expectedSnapshot: original }); await store.saveProject(project);
	if (mode !== 'unconsolidated') {
		const copy = await store.duplicateProject(project.id, { title: 'Copy' }); assert.ok(copy);
		const result = await consolidateProjectMedia({ projectId: copy.id, project: copy, store });
		assert.equal(result.run.complete, true); assert.equal(await store.getLinkedOriginalBinding(copy.id, source.id), null);
	}
	const before = await store.getLinkedOriginalBinding(project.id, source.id); assert.ok(before);
	const failure = new DOMException('Cannot read owned PCM inventory', 'UnknownError');
	if (mode === 'read-failed') indexedDB.onNextGetForStore('sources', () => { throw failure; });
	const operation = store.relinkLinkedAudioOriginal(project.id, source, 'replacement_locator_00001', {
		expectedBindingToken: before.bindingToken, expectedSnapshot: replacement,
		...(mode === 'changed' || mode === 'unconsolidated' ? { admission: 'changed-content' as const } : {}),
	});
	if (mode === 'changed') await assert.rejects(operation, /managed audio.*Import.*new media/u);
	else if (mode === 'read-failed') await assert.rejects(operation, error => error === failure);
	else await operation;
	const after = await store.getLinkedOriginalBinding(project.id, source.id); assert.ok(after);
	if (mode === 'changed' || mode === 'read-failed') assert.deepEqual(after, before);
	else assert.equal(after.locatorId, 'replacement_locator_00001');
	const pcm = await store.readSourceChunk(source.storageKey, 0); assert.equal(pcm.channels[0]?.[0], mode === 'unconsolidated' ? -.5 : .25);
	assert.deepEqual(await store.loadProject(project.id), project, 'Relink never changes either canonical document');
});

function wav(value: number): Blob {
	const bytes = encodeWav([new Float32Array(4096).fill(value)], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(bytes instanceof Uint8Array); return new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' });
}
