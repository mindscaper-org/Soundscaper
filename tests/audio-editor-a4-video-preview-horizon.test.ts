/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportVideoFile } from '../src/common/editor/controller/import/internal/source-import.ts';
import { audioEditorVideoThumbnailTimes } from '../src/common/editor/video-media.js';
import { createFixture } from './helpers/audio-editor-source-import-fixture.ts';
import { unequalAvPreviewFixture } from './helpers/unequal-av-preview-fixture.ts';

for (const audioSeconds of [2, 10] as const) test(`native ${audioSeconds}s container metadata does not extend the exact 2s picture thumbnail horizon`, async () => {
	const fixture = createFixture(); fixture.options.decodeMode = 'none';
	fixture.runtime.audioEditorVideoThumbnailTimes = audioEditorVideoThumbnailTimes;
	const factory = fixture.runtime.createAudioEditorVideoFrameExtractor;
	fixture.runtime.createAudioEditorVideoFrameExtractor = async file => {
		const extractor = await factory(file);
		return { ...extractor, metadata: { ...extractor.metadata, durationSeconds: audioSeconds, width: 64, height: 32 } };
	};
	const begin = fixture.runtime.store.beginMediaAssetWrite; assert.ok(begin);
	fixture.runtime.store.beginMediaAssetWrite = async (...args) => {
		const writer = await begin(...args);
		return { ...writer, maximumChunkBytes: 65536, get bytesWritten() { return writer.bytesWritten; } };
	};
	await createImportVideoFile(fixture.runtime)(unequalAvPreviewFixture(audioSeconds), { destination: 'timeline', trackId: null, timelineStartFrame: 0 });
	const video = fixture.addedSources.find(source => source.kind === 'video'); assert.ok(video);
	assert.equal(video.sourceFrameCount, 60); assert.equal(video.sampleFrameCount, 96000);
	const timestamps = fixture.derivatives.filter(value => value.type === 'thumbnail').map(value => value.timestamp);
	assert.deepEqual(timestamps, audioEditorVideoThumbnailTimes(2), 'Only exact picture presentation requests may enter the native seek queue.');
});
