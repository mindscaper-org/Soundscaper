/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFreesoundClipUploadMaterializer } from '../src/common/editor/controller/track-audio/internal/freesound-clip-upload-materializer.ts';
import { encodeWav } from '../src/common/editor/wav.js';

for (const width of [1, 2, 6]) test(`clip upload admits the exact ${width}-channel WAV extent and refuses one byte less before rendering`, async () => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 11, channelCount: width });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 11, sourceDurationFrames: 11 });
	const project = createSoundscaperProject({ id: 'clip-budget', sampleRate: 48_000, masterChannels: width,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const channels = Array.from({ length: width }, () => new Float32Array(11).fill(.25));
	const maximumBytes = encodeWav(channels, { sampleRate: 48_000, bitDepth: 24, float: false }).byteLength;
	let renders = 0;
	const renderClip = async () => {
		renders += 1;
		return { sampleRate: 48_000, length: 11, numberOfChannels: width, getChannelData: (channel: number) => channels[channel]! };
	};
	const exact = createFreesoundClipUploadMaterializer({ getProject: () => project, maximumBytes, renderClip });
	assert.equal((await exact.materialize({ projectId: project.id, clipId: clip.id })).file.size, maximumBytes);
	assert.equal(renders, 1);
	const tooSmall = createFreesoundClipUploadMaterializer({ getProject: () => project, maximumBytes: maximumBytes - 1, renderClip });
	await assert.rejects(tooSmall.materialize({ projectId: project.id, clipId: clip.id }), /100 MB/u);
	assert.equal(renders, 1, 'an output known not to fit must never render');
});
