/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import { BlobSource, Input, MP4 } from 'mediabunny';
import {
	assertDecodedVideoAudioWorkload, assertMinimumVideoAudioWindow, explicitVideoAacLcGeometry, planVideoAudioWorkload,
	readVideoAudioWorkload, VideoAudioOutputLimitError, VideoAudioWholeFileLimitError,
} from '../src/common/editor/controller/import/internal/video-import-audio-workload.ts';
import { nativeVideoAudioTailFixture } from './helpers/native-video-audio-tail-fixture.ts';
import { videoRetimePreviewMedia } from './browser/fixtures/video-retime-preview-media.js';

const MAXIMUM_MONO_FRAMES = 128 * 1024 ** 2 / 4;
const config = (description = Uint8Array.of(0x11, 0x88, 0x56, 0xe5, 0)): AudioDecoderConfig => ({
	codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 1, description,
});

for (const picture of [1, 2] as const) test(`ordinary ${picture}s-picture/2s-AAC exposes its full coded workload without decoding`, async () => {
	const file = new Blob([Uint8Array.from(nativeVideoAudioTailFixture(picture))]);
	const workload = await readVideoAudioWorkload(file); assert.ok(workload);
	assert.equal(workload.sampleRate, 48_000); assert.equal(workload.channelCount, 1);
	const input = new Input({ source: new BlobSource(file), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack(); assert.ok(track);
		const stats = await track.computePacketStats(undefined, { metadataOnly: true });
		assert.equal(workload.codedFrameCount, stats.packetCount * 1024);
	} finally { input.dispose(); }
});

test('explicit AAC-LC reconstruction excludes implicit SBR, PS, PCE, unknown widths and core dependencies', () => {
	assert.deepEqual(explicitVideoAacLcGeometry(config()), { sampleRate: 48_000, channelCount: 1 });
	for (const bytes of [Uint8Array.of(0x11, 0x88), Uint8Array.of(0x11, 0x88, 0x56, 0xe5, 0x80),
		Uint8Array.of(0x11, 0x89, 0x56, 0xe5, 0), Uint8Array.of(0x11, 0x80, 0x56, 0xe5, 0),
		Uint8Array.of(0x29, 0x88, 0x56, 0xe5, 0), Uint8Array.of(0x11, 0x88, 0x56, 0xe5, 1)]) {
		assert.equal(explicitVideoAacLcGeometry(config(bytes)), null);
	}
	assert.equal(explicitVideoAacLcGeometry({ ...config(), sampleRate: 44_100 }), null);
	assert.equal(explicitVideoAacLcGeometry({ ...config(), numberOfChannels: 2 }), null);
});

test('coded whole-file work and authored output use separate bounds and actual native context clocks', () => {
	const workload = { codedFrameCount: MAXIMUM_MONO_FRAMES + 1024, sampleRate: 48_000, channelCount: 1 };
	assert.deepEqual(planVideoAudioWorkload(workload, 2, 48_000, 48_000), { nativeWholeFile: false, ffmpegWholeFile: false });
	assert.throws(() => planVideoAudioWorkload(workload, 900, 48_000, 48_000), VideoAudioOutputLimitError);
	const smaller = { ...workload, codedFrameCount: MAXIMUM_MONO_FRAMES / 2 + 1024 };
	assert.deepEqual(planVideoAudioWorkload(smaller, 2, 48_000, 96_000), { nativeWholeFile: false, ffmpegWholeFile: true });
	assert.deepEqual(planVideoAudioWorkload(smaller, 2, 96_000, 48_000), { nativeWholeFile: false, ffmpegWholeFile: false });
	assert.deepEqual(planVideoAudioWorkload(null, 900, 48_000, 48_000), { nativeWholeFile: true, ffmpegWholeFile: true });
});

test('the exact canonical boundary passes while the following frame is refused', () => {
	const workload = { codedFrameCount: MAXIMUM_MONO_FRAMES, sampleRate: 48_000, channelCount: 1 };
	assert.deepEqual(planVideoAudioWorkload(workload, MAXIMUM_MONO_FRAMES / 48_000, 48_000, 48_000), { nativeWholeFile: true, ffmpegWholeFile: true });
	assert.throws(() => planVideoAudioWorkload(workload, (MAXIMUM_MONO_FRAMES + 1) / 48_000, 48_000, 48_000), VideoAudioOutputLimitError);
});

test('post-decode bounds precede plane access and every canonical copy', () => {
	const decoded = { length: MAXIMUM_MONO_FRAMES + 1, numberOfChannels: 1, sampleRate: 48_000,
		getChannelData(): Float32Array { assert.fail('An oversized native plane must not be accessed.'); } };
	assert.throws(() => assertDecodedVideoAudioWorkload(decoded, 2, 48_000), VideoAudioWholeFileLimitError);
	assert.throws(() => assertDecodedVideoAudioWorkload(decoded, 900, 48_000), VideoAudioOutputLimitError);
	const resampled = { ...decoded, length: MAXIMUM_MONO_FRAMES / 2 + 1 };
	assert.throws(() => assertDecodedVideoAudioWorkload(resampled, 2, 96_000), VideoAudioWholeFileLimitError);
	const small = { channels: [Float32Array.of(.25)], sampleRate: 48_000 };
	assert.doesNotThrow(() => assertDecodedVideoAudioWorkload(small, 2, 48_000));
});

test('silent and incomplete movies cannot claim workload authority', async () => {
	assert.equal(await readVideoAudioWorkload(new Blob([videoRetimePreviewMedia.file.buffer])), null);
	const file = new Blob([Uint8Array.from(nativeVideoAudioTailFixture(1))]);
	assert.equal(await readVideoAudioWorkload(file.slice(0, file.size - 1)), null);
});

test('cancellation releases a held metadata read before any decoder or late continuation', async () => {
	const abort = new AbortController(); let release!: (value: ArrayBuffer) => void, reads = 0;
	class Held extends Blob {
		override slice(): Blob {
			reads++;
			return { arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { release = resolve; }) } as Blob;
		}
	}
	const pending = readVideoAudioWorkload(new Held([new Uint8Array(64)]), abort.signal);
	await new Promise<void>(resolve => setImmediate(resolve));
	const reason = new DOMException('Retired import', 'AbortError'); abort.abort(reason);
	await assert.rejects(pending, error => error === reason);
	release(new ArrayBuffer(8)); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(reads, 1);
});

// The owning-path cases below use encoded media and throwing sentinels only.
// No test constructs a900s PCM buffer, including when replaying original source.

test('the universal picture window has a channel-independent hard lower bound', () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/controller/import/internal/video-import-audio-workload.ts'), 'editor-import-admission');
	assert.throws(() => assertMinimumVideoAudioWindow(900, 48_000), VideoAudioOutputLimitError);
	assert.doesNotThrow(() => assertMinimumVideoAudioWindow(2, 48_000));
});
