/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProject } from '../../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../../src/common/editor/storage.js';
import { exportScapeProject } from '../../../src/common/editor/scape-project.js';

/** A resident source keeps live-effect continuity independent of storage streaming. */
export async function liveEffectToneProject() {
	const source = createAudioSource({ id: 'tone', name: 'Continuous tone', sampleRate: 48_000,
		frameCount: 16 * 48_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: crypto.randomUUID(), sampleRate: 48_000, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount,
			sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'track', name: 'Continuous tone', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) {
			await writer.write([Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) },
				(_, frame) => .6 * Math.sin(2 * Math.PI * 1000 * (offset + frame) / 48_000))]);
		}
		await writer.commit();
		const archive = await exportScapeProject(project, store);
		if (!archive.blob) throw new Error('The continuous-tone archive did not produce a body.');
		return { projectId: project.id, file: { name: 'Continuous tone.sscape', mimeType: 'application/zip',
			buffer: Buffer.from(await archive.blob.arrayBuffer()) } };
	} finally { await store.close(); }
}
