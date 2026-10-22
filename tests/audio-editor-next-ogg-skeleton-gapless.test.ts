/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeDedicatedAudioPcm } from '../src/common/editor/browser-dedicated-audio-codec.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';
import { createController, createTwoTrackFixture, storedSample } from './helpers/audio-editor-multitrack-selection-harness.js';

function skeletonPage(): Uint8Array<ArrayBuffer> {
	// Standard 64-byte fishead with version3 and rational presentation/base times.
	const page = new Uint8Array(28 + 64);
	page.set(new TextEncoder().encode('OggS'));
	page[5] = 6; // BOS/EOS: this auxiliary logical stream has no further packets.
	page[26] = 1; page[27] = 64;
	const view = new DataView(page.buffer);
	view.setUint32(14, 42, true);
	page.set(new TextEncoder().encode('fishead\0'), 28);
	view.setUint16(28 + 8, 3, true);
	view.setBigUint64(28 + 20, 1000n, true);
	view.setBigUint64(28 + 36, 1000n, true);
	let checksum = 0;
	for (const value of page) {
		checksum ^= value << 24;
		for (let bit = 0; bit < 8; bit++) checksum = (checksum << 1) ^ (checksum & 0x8000_0000 ? 0x04c1_1db7 : 0);
	}
	view.setUint32(22, checksum >>> 0, true);
	return page;
}

for (const format of ['opus', 'ogg-vorbis'] as const) test(`File Open retains the ${format} programme length beside a leading Skeleton stream`, async () => {
	const frames = 48_001;
	const pcm = Float32Array.from({ length: frames }, (_, index) => Math.cos(index * .03) * .1);
	const bytes = await encodeDedicatedAudioPcm({ format, input: new Uint8Array(pcm.buffer), frameCount: frames,
		sampleRate: 48_000, channelCount: 1, settings: format === 'opus' ? { bitrateKbps: 128, vbrMode: 1 } : { quality: 6 },
		maximumOutputBytes: 1024 ** 2 }, { loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => input instanceof URL && input.protocol === 'file:'
		? new Response(Uint8Array.from(await readFile(input))) : originalFetch(input, init);
	const { store } = await createTwoTrackFixture(`next-skeleton-${format}`, new Map<string, Float32Array>(), 48_000);
	const controller = createController(store, undefined);
	try {
		// The ordinary primary-stream recording provides a PCM authority for the multiplexed copy.
		const reference = await prepareStreamedAudioImport(new File([bytes], 'Reference.ogg', { type: 'audio/ogg' }));
		let firstSample: number | undefined;
		await reference.stream({ chunkFrames: 65_536, onChunk(channels) { firstSample ??= channels[0]![0]; } });
		await controller.ready;
		await controller.actions.project.importFiles([new File([skeletonPage(), bytes], 'Multiplexed.ogg', { type: 'audio/ogg' })], { destination: 'timeline' });
		const project = controller.getSnapshot().project;
		assert.ok(validateAudioEditorProjectV17(project));
		assert.equal(project.sources.length, 1, 'File Open must publish the healthy audio stream');
		const source = project.sources[0]!;
		assert.equal(source.frameCount, frames, 'codec end padding must not extend the authored programme');
		assert.equal(project.clips[0]?.durationFrames, frames);
		assert.equal(await storedSample(store, source.id, 0), firstSample);
	} finally { await controller.dispose(); globalThis.fetch = originalFetch; }
});
