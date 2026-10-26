/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';

export async function deliverySelectionArchive(): Promise<Blob> {
	const source = createAudioSource({ id: 'take', name: 'Take.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'delivery-clip-selection', sampleRate: 48_000,
		sources: [source], tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['selected', 'other'] })],
		clips: [createAudioClip({ id: 'selected', sourceId: source.id, title: 'Selected take', timelineStartFrame: 48_000,
			durationFrames: 24_000, sourceDurationFrames: 24_000 }),
		createAudioClip({ id: 'other', sourceId: source.id, title: 'Other take', timelineStartFrame: 144_000,
			durationFrames: 48_000, sourceDurationFrames: 48_000 })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `delivery-clip-selection-archive-${crypto.randomUUID()}` });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(0.25)]);
		await writer.commit();
		const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store);
		assert.ok(archive.blob instanceof Blob);
		return archive.blob;
	} finally { await store.close(); }
}
