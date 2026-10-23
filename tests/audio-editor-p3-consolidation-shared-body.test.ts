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

for (const mode of ['shared', 'new', 'different-body', 'unreadable-body', 'different-pcm', 'different-clock', 'aborted-reuse', 'multichunk'] as const) test(`linked consolidation reuses only the identical immutable body; mode=${mode}`, async context => {
	const runtime = await loadWavPackWasm(await readFile(new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url)));
	const codec = {
		async encode(input: ArrayBuffer, options: Record<string, unknown>) { return encodePcmAdaptively(input, { ...options, runtime }); },
		async decode(input: ArrayBuffer, options: Record<string, unknown>) { return { payload: decodePcmWithWavPack(input, { ...options, runtime }) }; },
	};
	const frameCount = mode === 'multichunk' ? 140_003 : 4096;
	const original = wav(.25, frameCount);
	const port: LinkedOriginalPort = { load(_kind, locatorId) {
		return { blob: original, locatorRevision: `${locatorId}_revision` };
	}, release() { return true; } };
	const indexedDB = createInstrumentedIndexedDB();
	const store = createProjectStore({ indexedDB: indexedDB as unknown as IDBFactory, memoryFallback: false,
		preferOpfs: false, databaseName: context.name, pcmCodec: codec, linkedOriginalPort: port });
	context.after(async () => { await store.close(); }); await store.ready();
	const source = createAudioSource({ id: 'linked', storageKey: 'linked', sampleRate: 48_000, frameCount, channelCount: 1, mimeType: 'audio/wav' });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: frameCount, sourceDurationFrames: frameCount });
	const project = createSoundscaperProject({ id: 'original', sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	await store.bindLinkedAudioOriginal(project.id, source, 'original_locator_00001', { expectedSnapshot: original }); await store.saveProject(project);
	if (['shared', 'aborted-reuse', 'multichunk'].includes(mode)) {
		const copy = await store.duplicateProject(project.id, { title: 'Copy' }); assert.ok(copy);
		const first = await consolidateProjectMedia({ projectId: copy.id, project: copy, store });
		assert.equal(first.run.complete, true);
		assert.equal(await store.getLinkedOriginalBinding(copy.id, source.id), null);
		assert.ok(await store.getLinkedOriginalBinding(project.id, source.id));
	}
	if (mode === 'different-body' || mode === 'unreadable-body') {
		await store.writeMediaAsset(source.id, wav(-.5), { mimeType: 'audio/wav' });
		if (mode === 'unreadable-body') indexedDB.onNextGetForStore('mediaAssets', () => { throw new Error('Managed media is unreadable'); });
	}
	if (mode === 'different-pcm' || mode === 'different-clock') {
		await store.writeMediaAsset(source.id, original, { mimeType: 'audio/wav' });
		const writer = await store.beginSourceWrite(source.id, { sampleRate: mode === 'different-clock' ? 24_000 : 48_000, channelCount: 1 });
		await writer.write([new Float32Array(frameCount).fill(-.5)]); await writer.commit();
	}
	const abort = new AbortController();
	if (mode === 'aborted-reuse') {
		const open = store.openSourceReadSession.bind(store);
		store.openSourceReadSession = async (...args) => {
			const input = await open(...args); if (!input) return input;
			return { ...input, async chunk(...chunkArgs) { const value = await input.chunk(...chunkArgs); abort.abort(); return value; } };
		};
		await assert.rejects(consolidateProjectMedia({ projectId: project.id, project, store, signal: abort.signal }), { name: 'AbortError' });
		assert.ok(await store.getLinkedOriginalBinding(project.id, source.id)); return;
	}
	const second = await consolidateProjectMedia({ projectId: project.id, project, store });
	if (['different-body', 'unreadable-body', 'different-pcm', 'different-clock'].includes(mode)) {
		assert.equal(second.run.complete, false);
		assert.ok(await store.getLinkedOriginalBinding(project.id, source.id), 'failed reuse retains the original binding');
		assert.deepEqual(await store.loadProject(project.id), project);
		return;
	}
	assert.equal(second.run.complete, true, JSON.stringify(second.run.report));
	assert.equal(await store.getLinkedOriginalBinding(project.id, source.id), null);
	assert.deepEqual(await (await store.loadMediaAsset(source.id))?.arrayBuffer(), await original.arrayBuffer());
	const pcm = await store.readSourceChunk(source.id, 0); assert.ok(pcm);
	assert.deepEqual(pcm.channels[0], new Float32Array(Math.min(frameCount, 65_536)).fill(.25));
	assert.deepEqual(await store.loadProject(project.id), project, 'physical consolidation retains the canonical document');
});

function wav(value: number, frames = 4096): Blob {
	const bytes = encodeWav([new Float32Array(frames).fill(value)], { sampleRate: 48_000, float: true, dither: 'none' });
	assert.ok(bytes instanceof Uint8Array); return new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' });
}
