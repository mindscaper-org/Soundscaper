/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import type { AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

/** Reopen the actual edited document in a fresh product repository and check independent PCM. */
export async function assertEditedAudioArchiveCustody(context: TestContext, store: AudioEditorProjectStore,
	project: unknown, expectedChannels: readonly Float32Array[]) {
	assert.ok(validateSoundscaperProject(project));
	const persisted: unknown = await store.loadProject(project.id); assert.ok(validateSoundscaperProject(persisted));
	assert.deepEqual(persisted, project, 'the controller publication reaches the project repository');
	const runtime = createSoundscaperScapeNativeRuntime();
	const exported = await runtime.exportScapeProject(persisted, store); assert.ok(exported.blob);
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const imported = await runtime.importScapeProject(exported.blob, recipient); assert.equal(imported.readOnly, false);
	const reopened: unknown = imported.project; assert.ok(validateSoundscaperProject(reopened));
	assert.deepEqual(reopened, persisted, 'all clip, Bin, group, take and automation fields survive native Scape');
	if (expectedChannels.length === 0) { assert.equal(reopened.sources.length, 0); return reopened; }
	assert.equal(reopened.sources.length, 1);
	const source = reopened.sources[0]; assert.ok(source?.kind === 'audio');
	assert.equal(source.frameCount, expectedChannels[0]?.length); assert.equal(source.channelCount, expectedChannels.length);
	const channels = Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount));
	let frame = 0;
	for await (const chunk of recipient.readSourceChunks(source.storageKey)) {
		assert.equal(chunk.channels.length, source.channelCount);
		const count = chunk.channels[0]?.length; assert.ok(count);
		for (const [index, channel] of chunk.channels.entries()) { assert.equal(channel.length, count); channels[index]!.set(channel, frame); }
		frame += count;
	}
	assert.equal(frame, source.frameCount);
	assertPcmChannelsEqual(channels, expectedChannels, 'independently authored source PCM after edited project reopen');
	return reopened;
}
