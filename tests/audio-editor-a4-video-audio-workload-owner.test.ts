/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeImportedVideoAudio } from '../src/common/editor/controller/import/internal/video-import-audio-decode.ts';
import { VideoAudioOutputLimitError, VideoAudioWholeFileLimitError } from '../src/common/editor/controller/import/internal/video-import-audio-workload.ts';
import { readIsoAudioPresentationEnd } from '../src/common/editor/iso-audio-presentation-edit.ts';
import { oversizedVideoAudioFixture } from './helpers/oversized-video-audio-fixture.ts';
import { unequalAvPreviewFixture } from './helpers/unequal-av-preview-fixture.ts';
import { createImportVideoFile, type ImportVideoRuntime } from '../src/common/editor/controller/import/internal/source-import.ts';
import { createFixture } from './helpers/audio-editor-source-import-fixture.ts';

function owner(file: Blob) {
	const calls: string[] = [];
	const options = {
		file, hasAudio: true, projectSampleRate: 48_000, nativeContextSampleRate: 48_000, durationSeconds: 2,
		inspectEncodedSampleRate() { calls.push('inspect'); return 48_000; },
		async decodeNative(): Promise<never> { calls.push('native'); assert.fail('Unsafe native allocation reached.'); },
		async decodeContainerAudio(): Promise<never> { calls.push('container'); assert.fail('Oversized output reached the container decoder.'); },
		async decodeFfmpeg(): Promise<never> { calls.push('ffmpeg'); assert.fail('Oversized output reached FFmpeg.'); },
	};
	return { calls, options };
}

test('the real900s AAC file is refused before every decoder and PCM allocation', async () => {
	const { calls, options } = owner(oversizedVideoAudioFixture());
	await assert.rejects(decodeImportedVideoAudio(options), VideoAudioOutputLimitError);
	assert.deepEqual(calls, []);
});

test('the ordinary2s control retains native decoding and exact buffer identity', async () => {
	const { calls, options } = owner(unequalAvPreviewFixture(2));
	const decoded = { channels: [new Float32Array(96_000)], sampleRate: 48_000 };
	const result = await decodeImportedVideoAudio({ ...options, async decodeNative() { calls.push('native'); return decoded; } });
	assert.ok(result.decodedAudio === decoded); assert.deepEqual(calls, ['inspect', 'native']);
});

test('a short explicit edit of large coded media uses the bounded container, not whole-file decoding', async () => {
	const file = oversizedVideoAudioFixture(2), { calls, options } = owner(file);
	assert.equal(await readIsoAudioPresentationEnd(file, 2), 2);
	const decoded = { channels: [new Float32Array(96_000)], sampleRate: 48_000 };
	const result = await decodeImportedVideoAudio({ ...options, async decodeContainerAudio(_file, settings) {
		calls.push('container'); assert.equal(settings.durationSeconds, 2); return decoded;
	} });
	assert.ok(result.decodedAudio === decoded); assert.deepEqual(calls, ['container']);
});

test('an unavailable bounded route cannot restart unsafe whole-file FFmpeg for the short edit', async () => {
	const { calls, options } = owner(oversizedVideoAudioFixture(2));
	await assert.rejects(decodeImportedVideoAudio({ ...options, async decodeContainerAudio() {
		calls.push('container'); throw new Error('Packet decoder unavailable.');
	} }), VideoAudioWholeFileLimitError);
	assert.deepEqual(calls, ['container']);
});

test('an unknown profile still has a proven one-channel picture-window lower bound', async () => {
	const { calls, options } = owner(new Blob([new Uint8Array(4)]));
	await assert.rejects(decodeImportedVideoAudio({ ...options, durationSeconds: 900 }), VideoAudioOutputLimitError);
	assert.deepEqual(calls, []);
});

test('one programme capacity failure does not globally reject a different small fallback programme', async () => {
	const { calls, options } = owner(new Blob([new Uint8Array(4)]));
	const decoded = { channels: [Float32Array.of(.25)], sampleRate: 48_000 };
	const result = await decodeImportedVideoAudio({ ...options,
		async decodeNative() { calls.push('native'); throw new Error('Unavailable native decoder.'); },
		async decodeContainerAudio() {
			calls.push('container'); return { numberOfChannels: 32, sampleRate: 48_000, length: 33_554_432,
				getChannelData(): Float32Array { assert.fail('The oversized plane must not be read.'); } };
		},
		async decodeFfmpeg() { calls.push('ffmpeg'); return decoded; },
	});
	assert.ok(result.decodedAudio === decoded); assert.deepEqual(calls, ['inspect', 'native', 'container', 'ffmpeg']);
});

test('full import keeps the exact video publication and notice while every audio allocation remains untouched', async () => {
	const fixture = createFixture(), file = oversizedVideoAudioFixture(), reached: string[] = [];
	const factory = fixture.runtime.createAudioEditorVideoFrameExtractor;
	const begin = fixture.runtime.store.beginMediaAssetWrite; assert.ok(begin);
	const runtime: ImportVideoRuntime = { ...fixture.runtime,
		createAudioEditorVideoFrameExtractor: async (...args) => {
			const extractor = await factory(...args);
			return { ...extractor, metadata: { ...extractor.metadata, durationSeconds: 900, width: 64, height: 32 } };
		},
		engine: { ...fixture.runtime.engine, async decodeAudioData() { reached.push('native'); assert.fail('Native allocation reached.'); } },
		async decodeContainerAudio() { reached.push('container'); assert.fail('Container allocation reached.'); },
		ffmpeg: { ...fixture.runtime.ffmpeg, async decode() { reached.push('ffmpeg'); assert.fail('FFmpeg allocation reached.'); } },
		async bufferFromChannels() { reached.push('copy'); assert.fail('PCM copy reached.'); },
		async canonicalizeBuffer() { reached.push('resample'); assert.fail('Canonical allocation reached.'); },
		async writeBuffer() { reached.push('write'); assert.fail('PCM write reached.'); },
		cacheSourceBuffer() { reached.push('cache'); assert.fail('PCM cache reached.'); },
	};
	runtime.store.beginMediaAssetWrite = async (...args) => {
		const writer = await begin(...args);
		return { ...writer, maximumChunkBytes: 65536, get bytesWritten() { return writer.bytesWritten; } };
	};
	const result = await createImportVideoFile(runtime)(file);
	assert.deepEqual(reached, []); assert.equal(result.audioSourceId, null); assert.equal(result.audioClipId, null);
	assert.ok(result.notice?.includes('The video was imported without audio.'));
	assert.deepEqual(fixture.addedSources.map(source => source.kind), ['video']);
	assert.equal(fixture.addedSources[0]!.sourceFrameCount, 60);
	assert.equal(fixture.sourceBuffers.size, 0); assert.equal(fixture.commits.length, 1);
});

test('the actual captured native context clock can bypass whole-file work even in a lower-rate project', async () => {
	const { calls, options } = owner(oversizedVideoAudioFixture(2));
	const decoded = { channels: [new Float32Array(96_000)], sampleRate: 48_000 };
	const result = await decodeImportedVideoAudio({ ...options, projectSampleRate: 8_000, nativeContextSampleRate: 48_000,
		async decodeContainerAudio() { calls.push('container'); return decoded; },
	});
	assert.ok(result.decodedAudio === decoded); assert.deepEqual(calls, ['container']);
});
