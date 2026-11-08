/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { publishLocalAssistanceAudioSource } from '../src/common/editor/controller/assistance/internal/audio/local-assistance-audio-source-publication.ts';
import { output } from './helpers/local-assistance-audio-publication-fixture.ts';

test('model audio is stored at exact project geometry in bounded canonical PCM chunks', async () => {
	const modelFrames = 70_000;
	const projectFrames = Math.round(modelFrames * 48_000 / 44_100);
	const result = await output('dereverberation', 'dereverberated-audio', '1'.repeat(40), [
		Array<number>(modelFrames).fill(0.5), Array<number>(modelFrames).fill(-0.25),
	]);
	const chunks: Float32Array[][] = [];
	let metadata: Readonly<Record<string, unknown>> | undefined;
	const source = await publishLocalAssistanceAudioSource({
		beginSourceWrite: async (_id, beginning) => {
			assert.equal(beginning.sampleRate, 48_000);
			assert.equal(beginning.contentSha256, undefined);
			return {
				write: async (channels) => { chunks.push(channels.map(channel => channel.slice())); },
				commit: async (value) => { metadata = value; },
				abort: async () => { throw new Error('Successful conformance cannot abort.'); },
			};
		},
		deleteSource: async () => { throw new Error('Successful conformance cannot delete the source.'); },
	}, { id: 'canonical', name: 'Canonical', sampleRate: 48_000,
		frameCount: projectFrames, originalSampleRate: 44_100,
		contentSha256: result.claim.sha256, byteLength: result.claim.byteLength }, result, 65_536);
	assert.deepEqual(chunks.map(channels => channels[0]!.length), [65_536, projectFrames - 65_536]);
	assert.ok(Math.abs(chunks[0]![0]![30_000]! - 0.5) < 0.001);
	assert.ok(Math.abs(chunks[0]![1]![30_000]! + 0.25) < 0.001);
	const digest = createHash('sha256');
	let byteLength = 0;
	for (const channels of chunks) {
		const header = Buffer.alloc(4);
		header.writeUInt32LE(channels[0]!.length);
		digest.update(header); byteLength += header.length;
		for (const channel of channels) {
			const bytes = Buffer.alloc(channel.length * 4);
			for (const [index, sample] of channel.entries()) bytes.writeFloatLE(sample, index * 4);
			digest.update(bytes); byteLength += bytes.length;
		}
	}
	assert.equal(source.contentSha256, digest.digest('hex'));
	assert.equal(source.byteLength, byteLength);
	assert.equal(source.originalSampleRate, 44_100);
	assert.equal(metadata?.contentSha256, source.contentSha256);
	assert.equal(metadata?.byteLength, source.byteLength);
	assert.notEqual(source.contentSha256, result.claim.sha256);
});
