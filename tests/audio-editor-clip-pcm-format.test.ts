/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertPcmPrecision, reinterpretPcmChannels } from '../src/common/editor/controller/track-audio/internal/clip-pcm-format.ts';
import { reinterpretedClipCommands } from '../src/common/editor/controller/track-audio/internal/clip-reinterpret-commands.ts';
import { apply, createFixture } from './helpers/audio-editor-model-harness.js';
import { createAddClipCommand, createAddSourceCommand } from '../src/common/editor/commands/factories.ts';
import type { ControllerClip, ControllerSource } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

test('PCM conversion changes sample precision without changing the channel/frame layout', () => {
	const input = [Float32Array.of(-1, -0.1234567, 0, 0.1234567, 1.5)];
	const output = convertPcmPrecision(input, 'int16');
	assert.deepEqual([...output[0]!], [-1, -4045 / 32768, 0, 4045 / 32768, 32767 / 32768]);
	assert.equal(input[0]![4], 1.5);
	assert.equal(convertPcmPrecision(input, 'float32'), input);
});

test('reinterpreting a rate alone retains the exact float samples and channel arrays', () => {
	const input = [Float32Array.of(-0.1234567, 0.9876543)];
	assert.equal(reinterpretPcmChannels(input, 'int16', 'int16'), input);
});

test('PCM reinterpretation preserves the interleaved bytes while changing the sample width', () => {
	// The float32 1.0 is bytes 00 00 80 3f, read as two signed 16-bit samples.
	const output = reinterpretPcmChannels([Float32Array.of(1), Float32Array.of(-1)], 'float32', 'int16');
	assert.deepEqual(output.map(channel => [...channel]), [[0, 0], [16256 / 32768, -16512 / 32768]]);
	const restored = reinterpretPcmChannels(output, 'int16', 'float32');
	assert.deepEqual(restored.map(channel => [...channel]), [[1], [-1]]);
});

test('reinterpretation rejects incomplete frames and non-finite float results', () => {
	assert.throws(() => reinterpretPcmChannels([Float32Array.of(0)], 'int16', 'int24'), /complete.*frame/i);
	assert.throws(() => reinterpretPcmChannels([Float32Array.of(-1 / 32768, -1 / 32768)], 'int16', 'float32'), /non-finite/i);
});

test('a rate reinterpretation changes one clip duration and keeps its source window and siblings', () => {
	let project = createFixture({ frameCount: 480 });
	project = apply(project, createAddClipCommand('track-1', { id: 'clip', sourceId: 'source-1',
		timelineStartFrame: 50, sourceStartFrame: 12, sourceDurationFrames: 100, durationFrames: 100,
		fadeInFrames: 10, envelope: [{ frame: 0, value: 1 }, { frame: 100, value: 0.5 }] }));
	project = apply(project, createAddClipCommand('track-2', { id: 'sibling', sourceId: 'source-1', durationFrames: 40 }));
	const source = project.sources[0] as ControllerSource;
	const clip = project.clips[0] as unknown as ControllerClip;
	const replacement = { ...source, id: 'reinterpret', storageKey: 'reinterpret', sampleRate: source.sampleRate / 2 };
	project = apply(project, createAddSourceCommand(replacement));
	for (const command of reinterpretedClipCommands('track-1', clip, source, replacement)) project = apply(project, command);
	const result = project.clips.find(value => value.id === 'clip')!;
	assert.equal(result.durationFrames, 200);
	assert.equal(result.timelineStartFrame, 50);
	assert.equal(result.sourceStartFrame, 12);
	assert.equal(result.sourceDurationFrames, 100);
	assert.equal(result.fadeInFrames, 20);
	assert.deepEqual(result.envelope, [{ frame: 0, value: 1 }, { frame: 200, value: 0.5 }]);
	assert.equal(project.clips.find(value => value.id === 'sibling')!.sourceId, source.id);
});

test('reinterpretation rejects linked, looping and warped clocks before producing commands', () => {
	const source = { id: 'source', sampleRate: 16000, frameCount: 100 } as ControllerSource;
	const clip = { id: 'clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: 100, durationFrames: 300 } as ControllerClip;
	for (const changes of [{ avLinkId: 'camera' }, { warpMap: {} }, { anchor: 'musical' },
		{ opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 100, offsetFrames: 0 } } }]) {
		assert.throws(() => reinterpretedClipCommands('track', { ...clip, ...changes }, source,
			{ ...source, id: 'replacement', sampleRate: 8000 }), /reinterpret.*(unlink|render|loop|musical)/i);
	}
});

test('PCM reinterpretation resolves an exact half-sample duration on the shared point policy', () => {
	const original: ControllerSource = { id: 'source', storageKey: 'source', name: 'Source', mimeType: 'audio/wav',
		frameCount: 3, channelCount: 1, sampleRate: 24_000, originalSampleRate: 24_000, sampleFormat: 'int16' };
	const channels = reinterpretPcmChannels([Float32Array.of(0, 0, 0)], 'int16', 'int24');
	const replacement: ControllerSource = { ...original, id: 'replacement', storageKey: 'replacement',
		frameCount: channels[0]!.length, channelCount: channels.length, sampleRate: 32_000, sampleFormat: 'int24' };
	assert.equal(replacement.frameCount, 2);
	assert.equal(replacement.channelCount, original.channelCount);
	const clip: ControllerClip = { id: 'clip', sourceId: original.id, timelineStartFrame: 50,
		sourceStartFrame: 0, sourceDurationFrames: 3, durationFrames: 7, fadeInFrames: 3,
		envelope: [{ frame: 0, value: 1 }, { frame: 7, value: 0.5 }] };
	const commands = reinterpretedClipCommands('track', clip, original, replacement);
	const add = commands.find(command => command.type === 'clip/add');
	assert.ok(add && add.type === 'clip/add');
	// 7 × (2/3) × (24000/32000) is exactly 3.5; rounding the floating
	// intermediate instead can incorrectly shorten the clip to three frames.
	assert.equal(add.clip.durationFrames, 4);
	assert.equal(add.clip.timelineStartFrame, 50);
	assert.equal(add.clip.sourceDurationFrames, 2);
	assert.equal(add.clip.fadeInFrames, 2);
	assert.deepEqual(add.clip.envelope, [{ frame: 0, value: 1 }, { frame: 4, value: 0.5 }]);
});
