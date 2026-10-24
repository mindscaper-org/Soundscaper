/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDecodedAudioSampleRate, inspectEncodedAudioSampleRate } from '../src/common/editor/audio-file-metadata.js';
import { prepareFreesoundUploadFile } from '../src/common/editor/ui/workspace/freesound-upload-file-preparation.ts';
import { sunPcmAu48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';

test('AU native decoding uses the authored source clock rather than the output device', async () => {
	const bytes = new Uint8Array(await sunPcmAu48_000Fixture().arrayBuffer());
	assert.equal(inspectEncodedAudioSampleRate(bytes), 48_000); assert.equal(inspectDecodedAudioSampleRate(bytes), 48_000);
	const backing = new Uint8Array(bytes.length + 7); backing.set(bytes, 3);
	assert.equal(inspectDecodedAudioSampleRate(backing.subarray(3, 3 + bytes.length)), 48_000);
});

test('native AU upload preparation preserves that same source clock', async () => {
	let requestedRate: number | undefined, encodedRate: number | undefined;
	await prepareFreesoundUploadFile(sunPcmAu48_000Fixture(), undefined, {
		createDecodeContext(options) {
			requestedRate = options?.sampleRate;
			const sampleRate = requestedRate ?? 44_100, length = sampleRate / 10;
			const channel = new Float32Array(length).fill(.2);
			return { decodeAudioData: () => Promise.resolve({ sampleRate, length, numberOfChannels: 1, duration: length / sampleRate,
				getChannelData: () => channel, copyFromChannel: destination => { destination.set(channel.subarray(0, destination.length)); },
				copyToChannel: source => { channel.set(source); } } satisfies AudioBuffer), close: () => Promise.resolve() };
		},
		encode(_channels, options) { encodedRate = options?.sampleRate; return Uint8Array.of(82, 73, 70, 70); },
	});
	assert.equal(requestedRate, 48_000); assert.equal(encodedRate, 48_000);
});

test('AU source-clock probing retains unknown-length recordings and rejects unqualified/truncated geometry', async () => {
	const bytes = new Uint8Array(await sunPcmAu48_000Fixture().arrayBuffer()), view = new DataView(bytes.buffer);
	view.setUint32(8, 0xffff_ffff); assert.equal(inspectDecodedAudioSampleRate(bytes), 48_000);
	for (const [offset, value] of [[4, 23], [4, bytes.length + 1], [8, bytes.length], [12, 8], [16, 0], [20, 0], [20, 65]]) {
		const changed = bytes.slice(); new DataView(changed.buffer).setUint32(offset!, value!);
		assert.equal(inspectDecodedAudioSampleRate(changed), null, `Invalid AU header at ${String(offset)} cannot pin a native clock.`);
	}
	assert.equal(inspectDecodedAudioSampleRate(bytes.subarray(0, 23)), null);
});
