/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFreesoundClipUploadMaterializer } from '../src/common/editor/controller/track-audio/internal/freesound-clip-upload-materializer.ts';
import { createFreesoundUploadMetadataDefaults } from '../src/common/editor/freesound-upload-metadata.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

for (const sampleRate of [44_100, 48_000, 96_000]) {
	test(`clip upload description uses rendered duration with a ${sampleRate} Hz source`, async () => {
		const source = createAudioSource({ id: 'source', sampleRate, frameCount: sampleRate / 10, channelCount: 1 });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Short take', timelineStartFrame: 0,
			durationFrames: 4800, sourceStartFrame: 0, sourceDurationFrames: sampleRate / 10 });
		const project = createSoundscaperProject({ id: 'upload-duration', sampleRate: 48_000, sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })] });
		const before = JSON.stringify(project);
		const materializer = createFreesoundClipUploadMaterializer({ getProject: () => project,
			async renderClip() {
				return { length: 4800, numberOfChannels: 2, sampleRate: 48_000,
					getChannelData: () => new Float32Array(4800).fill(.25) };
			},
		});
		const result = await materializer.materialize({ projectId: project.id, clipId: clip.id });
		const wav = await inspectWavBlobPcm(result.file);
		assert.equal(wav.frameCount / wav.sampleRate, .1);
		const description = createFreesoundUploadMetadataDefaults({ fileName: result.file.name, source: result.source, clip: result.clip }).description;
		assert.match(description, /0\.100 seconds/u);
		assert.deepEqual(result.source, source, 'original source facts and provenance retain their owner');
		assert.equal(JSON.stringify(project), before);
	});
}

test('source-only upload defaults keep the original source clock', () => {
	const source = { sampleRate: 44_100, frameCount: 4410, channelCount: 1 };
	assert.match(createFreesoundUploadMetadataDefaults({ fileName: 'Original.wav', source }).description, /0\.100 seconds/u);
});
