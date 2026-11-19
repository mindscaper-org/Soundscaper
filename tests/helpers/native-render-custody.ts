/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createProjectStore, type AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import { createStoredChunkProvider } from '../../src/common/editor/controller/source/source-audio.ts';
import { projectForRuntimeConsumers } from '../../src/common/editor/project-current-runtime.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createNodeWebAudioEngineFactory, type NodeWebAudioEngineFactory } from './node-web-audio-engine.ts';
import { readCustodyPcm } from './audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';

export async function writeProjectPcm(store: AudioEditorProjectStore, project: SoundscaperProject,
	pcm: ReadonlyMap<string, readonly Float32Array[]>): Promise<void> {
	for (const source of project.sources) {
		assert.ok(source.kind === 'audio'); const channels = pcm.get(source.id); assert.ok(channels);
		assert.equal(channels.length, source.channelCount);
		for (const channel of channels) assert.equal(channel.length, source.frameCount);
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += 65_536)
			await writer.write(channels.map(channel => channel.subarray(offset, offset + 65_536)));
		await writer.commit();
	}
}

/** Shipping stored-source provider and native offline graph, including unsupported source rates. */
export async function renderStoredProject(native: NodeWebAudioEngineFactory, store: AudioEditorProjectStore,
	project: SoundscaperProject, endFrame: number): Promise<AudioBuffer> {
	const renderer = native.createEngine();
	const providers = new Map<string, ReturnType<typeof createStoredChunkProvider>>();
	try {
		for (const source of project.sources) {
			assert.ok(source.kind === 'audio');
			const metadata = await store.getSourceMetadata(source.storageKey); assert.ok(metadata);
			providers.set(source.id, createStoredChunkProvider(store, source, metadata));
		}
		renderer.loadProject(projectForRuntimeConsumers(project), new Map(), { chunkSources: providers });
		const output = await renderer.renderMix({ startFrame: 0, endFrame }); assert.ok(output instanceof AudioBuffer);
		assert.equal(output.length, endFrame); assert.equal(output.sampleRate, project.sampleRate);
		return output;
	} finally {
		await renderer.dispose();
		await Promise.all([...providers.values()].map(provider => provider.dispose()));
	}
}

export async function assertNativeRenderRoundtrip(context: TestContext, project: SoundscaperProject,
	pcm: ReadonlyMap<string, readonly Float32Array[]>, endFrame: number, assertOutput: (output: AudioBuffer) => void): Promise<void> {
	const native = createNodeWebAudioEngineFactory(context), archive = createSoundscaperScapeNativeRuntime();
	const original = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:original` });
	const recipient = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:recipient` });
	try {
		await writeProjectPcm(original, project, pcm);
		const saved = await archive.exportScapeProject(project, original); assert.ok(saved.blob);
		const imported = await archive.importScapeProject(saved.blob, recipient); assert.equal(imported.readOnly, false);
		const reopened: unknown = imported.project; assert.ok(validateSoundscaperProject(reopened)); assert.deepEqual(reopened, project);
		for (const [repository, document] of [[original, project], [recipient, reopened]] as const) {
			for (const source of document.sources) {
				assert.ok(source.kind === 'audio'); const expected = pcm.get(source.id); assert.ok(expected);
				assertPcmChannelsEqual(await readCustodyPcm(repository, source), expected, 'original source PCM across Scape reopen');
			}
			assertOutput(await renderStoredProject(native, repository, document, endFrame));
		}
	} finally { await original.close(); await recipient.close(); await native.dispose(); }
}
