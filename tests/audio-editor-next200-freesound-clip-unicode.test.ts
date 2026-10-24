/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createFreesoundUploadMetadataDefaults } from '../src/common/editor/freesound-upload-metadata.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFreesoundClipUploadMaterializer } from '../src/common/editor/controller/track-audio/internal/freesound-clip-upload-materializer.ts';

for (const length of [219, 511]) test(`clip upload keeps Unicode intact at the ${length}-unit title boundary`, async () => {
	const title = `${'A'.repeat(length)}🎙`;
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 11, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title, durationFrames: 11, sourceDurationFrames: 11 });
	const project = createSoundscaperProject({ id: 'clip-unicode', sampleRate: 48_000,
		sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const materializer = createFreesoundClipUploadMaterializer({ getProject: () => project,
		async renderClip() { return { sampleRate: 48_000, length: 11, numberOfChannels: 2,
			getChannelData: () => new Float32Array(11).fill(.25) }; },
	});
	const result = await materializer.materialize({ projectId: project.id, clipId: clip.id });
	assert.equal(result.file.name, length === 219 ? `${title}.wav` : `${'A'.repeat(251)}.wav`);
	assert.equal(result.clipTitle, length === 219 ? title : 'A'.repeat(511));
	const defaults = createFreesoundUploadMetadataDefaults({ fileName: result.file.name, clip: result.clip, source: result.source });
	assert.equal(defaults.title, result.clipTitle);
});
