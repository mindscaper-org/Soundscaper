/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { BlobSource, Input, MATROSKA, WEBM } from 'mediabunny';
import { decodeBrowserContainerAudio } from '../src/common/editor/browser-container-audio-decode.ts';
import { disableReviewedAudioImportDecoders, enableReviewedAudioImportDecoder } from '../src/common/editor/browser-reviewed-streamed-audio-decoders.ts';
import { importAndReopenAudio } from './helpers/audio-import-archive-custody.ts';
import { matroskaMetadataCustodyCases } from './helpers/matroska-metadata-custody-cases.ts';
import { createReviewedAudioCodecRuntime, useLocalAudioCodecPayloads } from './helpers/reviewed-audio-codec-runtime.ts';

for (const fixture of await matroskaMetadataCustodyCases()) test(`real Opus import and Scape retain Matroska ${fixture.id}`, async context => {
	useLocalAudioCodecPayloads(context);
	context.after(() => { disableReviewedAudioImportDecoders(); });
	const codecs = createReviewedAudioCodecRuntime();
	// Node has no native AudioContext decoder. The fallback port executes the
	// maintained container demux/timestamp placement and reviewed Opus WASM.
	const codecRuntime = { ...codecs, decode: async (file: Blob, options: { signal?: AbortSignal } = {}) => {
		enableReviewedAudioImportDecoder('opus');
		const input = new Input({ source: new BlobSource(file), formats: [MATROSKA, WEBM] });
		try {
			const decoded = await decodeBrowserContainerAudio(file, { durationSeconds: await input.computeDuration(), signal: options.signal });
			return { ...decoded, channels: decoded.channels.map(channel => channel.slice()) };
		}
		finally { input.dispose(); }
	} };
	const { source, contribution, channels } = await importAndReopenAudio(context, fixture.file,
		{ codecRuntime });
	assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 1);
	assert.ok(source.frameCount > 2000); assert.equal(channels[0]?.length, source.frameCount);
	assert.ok(channels[0]?.some(sample => Math.abs(sample) > .05), 'reviewed Opus WASM must decode actual programme PCM');
	assert.deepEqual(contribution.warnings, []);
	for (const [key, expected] of Object.entries(fixture.normalized)) assert.deepEqual(contribution.metadata.normalized[key], expected, key);
	for (const [key, expected] of Object.entries(fixture.raw)) {
		assert.deepEqual(Object.getOwnPropertyDescriptor(contribution.metadata.raw, key)?.value, expected, key);
	}
	if (fixture.emptyMetadata) {
		assert.deepEqual(contribution.metadata.normalized, {}); assert.deepEqual(contribution.metadata.raw, {});
	}
	if (fixture.attachment) {
		const attachment = contribution.attachments.find(item => item.name === fixture.attachment?.name); assert.ok(attachment);
		assert.equal(attachment.byteLength, fixture.attachment.byteLength);
		assert.equal(attachment.sha256, createHash('sha256').update('Reviewed licence attachment').digest('hex'));
	}
});
