/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

export async function readCustodyPcm(store: AudioEditorProjectStore, source: {
	readonly storageKey: string; readonly channelCount: number; readonly frameCount: number;
}): Promise<Float32Array[]> {
	const channels = Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount));
	let frame = 0;
	for await (const chunk of store.readSourceChunks(source.storageKey)) {
		assert.equal(chunk.channels.length, channels.length);
		const count = chunk.channels[0]?.length; assert.ok(count);
		for (const [index, channel] of chunk.channels.entries()) {
			assert.equal(channel.length, count); channels[index]!.set(channel, frame);
		}
		frame += count;
	}
	assert.equal(frame, source.frameCount);
	return channels;
}

/** Authenticate every original/derived source across a real product save and independent repository reopen. */
export async function assertAudioProjectArchivePcm(context: TestContext, store: AudioEditorProjectStore, value: unknown,
	assertSource: (name: string, channels: readonly Float32Array[]) => void) {
	assert.ok(validateSoundscaperProject(value));
	const persisted: unknown = await store.loadProject(value.id); assert.ok(validateSoundscaperProject(persisted));
	assert.deepEqual(persisted, value);
	const before = new Map<string, Float32Array[]>();
	for (const source of persisted.sources) {
		assert.ok(source.kind === 'audio');
		const channels = await readCustodyPcm(store, source);
		assertSource(source.name, channels); before.set(source.id, channels);
	}
	const archive = createSoundscaperScapeNativeRuntime();
	const exported = await archive.exportScapeProject(persisted, store); assert.ok(exported.blob);
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const imported = await archive.importScapeProject(exported.blob, recipient); assert.equal(imported.readOnly, false);
	const reopened: unknown = imported.project; assert.ok(validateSoundscaperProject(reopened));
	assert.deepEqual(reopened, persisted);
	for (const source of reopened.sources) {
		assert.ok(source.kind === 'audio');
		const expected = before.get(source.id); assert.ok(expected);
		const channels = await readCustodyPcm(recipient, source);
		assertPcmChannelsEqual(channels, expected, `${source.name} PCM after independent Scape reopen`);
		assertSource(source.name, channels);
	}
	return reopened;
}
