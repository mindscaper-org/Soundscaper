/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareAssistanceWaveChannelGroup } from '../desktop/assistance-wave-channel-group-reader.ts';
import { createNodeAssistanceFloat32WaveStorageV1 } from '../desktop/assistance-streaming-float32-wave.ts';
import { nativeChildFileIdentityFromStat } from '../desktop/native-child-file-identity.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('one owned chunk reads each interleaved range once across dereverb channels and TIGER batches', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-channel-group-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(await realpath(root), 'input.wav');
	const channels = Array.from({ length: 6 }, (_, channel) =>
		Float32Array.from({ length: 384_000 }, (_, frame) => Math.sin(frame / 19 + channel)));
	const bytes = encodeWav(channels, { sampleRate: 44_100, bitDepth: 32, float: true, dither: false });
	await writeFile(path, bytes);
	let readBytes = 0;
	const storage = createNodeAssistanceFloat32WaveStorageV1((event) => {
		if (event.kind === 'input-read' && event.position >= 44) readBytes += event.byteLength;
	});
	const source = await storage.openSource({ claimId: '2'.repeat(40), role: 'audio',
		mediaType: 'audio/wav', path, byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: nativeChildFileIdentityFromStat(await stat(path, { bigint: true })) }, 44_100);
	try {
		const group = prepareAssistanceWaveChannelGroup(source);
		const ranges = [{ startFrame: 1, frameCount: 10_000 },
			{ startFrame: 0, frameCount: 364_000 }, { startFrame: 374_000, frameCount: 10_000 }];
		for (let channel = 0; channel < 6; channel += 1) {
			for (const range of ranges) {
				const read = await group.readFrames({ ...range, channelStart: channel, channelCount: 1 });
				assert.deepEqual(read[0], channels[channel]!.subarray(range.startFrame, range.startFrame + range.frameCount));
			}
		}
		assert.equal(readBytes, 384_000 * 6 * 4);
		readBytes = 0;
		const nextChunk = prepareAssistanceWaveChannelGroup(source);
		for (let channelStart = 0; channelStart < 6; channelStart += 2) {
			const read = await nextChunk.readFrames({ startFrame: 0, frameCount: 176_400, channelStart, channelCount: 2 });
			for (let index = 0; index < 2; index += 1) assert.deepEqual(read[index], channels[channelStart + index]!.subarray(0, 176_400));
		}
		assert.equal(readBytes, 176_400 * 6 * 4);
		const controller = new AbortController(); controller.abort();
		await assert.rejects(nextChunk.readFrames({ startFrame: 0, frameCount: 176_400, channelStart: 0, channelCount: 2 }, controller.signal), { name: 'AbortError' });
		await assert.rejects(nextChunk.readFrames({ startFrame: 0, frameCount: 176_400, channelStart: 5, channelCount: 2 }), RangeError);
	} finally { await source.close(); }
});
