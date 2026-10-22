/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { resolveDesktopOriginalExportSettings } from '../src/common/editor/desktop-original-export-settings.ts';
import { leadingId3AudioOffset } from '../src/common/editor/leading-id3-tags.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createController, createTwoTrackFixture, storedChannel } from './helpers/audio-editor-multitrack-selection-harness.js';

async function recording(): Promise<Uint8Array<ArrayBuffer>> {
	const pcm = Float32Array.from({ length: 48_001 }, (_, index) => Math.sin(index * .03) * .1);
	return encodeDedicatedAudioPcm({ format: 'mp3', input: new Uint8Array(pcm.buffer), frameCount: pcm.length,
		sampleRate: 48_000, channelCount: 1, settings: { bitrateKbps: 128 }, maximumOutputBytes: 1024 ** 2 },
	{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
}

test('File Open keeps the MP3 gapless range after consecutive leading ID3 tags', async () => {
	const encoded = await recording();
	const tags = [createAudioMetadataId3Tag({ title: 'Session title' }), createAudioMetadataId3Tag({ artist: 'Session artist' })];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (value, init) => value instanceof URL && value.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(value))) : originalFetch(value, init);
	const { store } = await createTwoTrackFixture('next-mp3-consecutive-tags', new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		const reference = await prepareStreamedAudioImport(new Blob([encoded], { type: 'audio/mpeg' }));
		const expected = new Float32Array(reference.descriptor.frameCount);
		let position = 0;
		await reference.stream({ chunkFrames: 65_536, onChunk(channels) { expected.set(channels[0]!, position); position += channels[0]!.length; } });
		await controller.ready;
		await controller.actions.project.importFiles([new File([...tags, encoded], 'Tagged recording.mp3', { type: 'audio/mpeg' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1);
		const source = project.sources[0]!;
		assert.equal(source.frameCount, 48_001, 'metadata must not turn encoder delay and padding into source audio');
		assert.deepEqual(await storedChannel(store, source.id, 0), expected);
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
});

test('Original MP3 derives its encoder strategy past every admitted leading ID3 tag', async () => {
	const encoded = await recording();
	const source = { kind: 'audio', sampleRate: 48_000, originalSampleRate: 48_000, channelCount: 1 };
	const original = await resolveDesktopOriginalExportSettings(new File([encoded], 'Plain.mp3'), [source]);
	assert.ok(original);
	const tags = Array.from({ length: 3 }, (_, index) => createAudioMetadataId3Tag({ title: `Title ${index}` }));
	assert.deepEqual(await resolveDesktopOriginalExportSettings(new File([...tags, encoded], 'Tagged.mp3'), [source]), original);
});


test('consecutive ID3 inspection seeks over large payloads with bounded cancellable reads', async () => {
	const first = Uint8Array.from(createAudioMetadataId3Tag({ title: 'Large tag' }));
	const length = 2 * 1024 * 1024;
	first.set([(length >>> 21) & 127, (length >>> 14) & 127, (length >>> 7) & 127, length & 127], 6);
	const second = createAudioMetadataId3Tag({ artist: 'Second tag' });
	const file = new Blob([first, new Uint8Array(10 + length - first.length), second, Uint8Array.of(255, 251, 144, 0)]);
	const reads: number[] = [];
	const source = { size: file.size, slice(start: number, end: number) { reads.push(end - start); return file.slice(start, end); } };
	assert.equal(await leadingId3AudioOffset(source), 10 + length + second.length);
	assert.ok(reads.every(size => size <= 10), 'tag payload bytes never enter the geometry probe');
	const abort = new AbortController();
	await assert.rejects(leadingId3AudioOffset({ size: file.size, slice(start: number, end: number) {
		abort.abort(); return file.slice(start, end);
	} }, undefined, abort.signal), { name: 'AbortError' });
	assert.equal(await leadingId3AudioOffset(new Blob([first])), null, 'truncated declared tag remains unprovable');
});
