/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

/** A normal native project retaining an already supported spectrogram scale. */
export function spectrogramScaleProject(scale = 'logarithmic') {
	const source = createAudioSource({ id: 'scale-source', frameCount: 4800, sampleRate: 48000, channelCount: 1 });
	const clip = createAudioClip({ id: 'scale-clip', sourceId: source.id, title: 'Logarithmic',
		durationFrames: 4800, sourceDurationFrames: 4800 });
	const track = createAudioTrack({ id: 'scale-track', name: 'Logarithmic', clipIds: [clip.id],
		displayMode: 'spectrogram', spectrogram: { scale } });
	const project = createSoundscaperProject({ id: 'spectrogram-logarithmic-alias',
		sources: [source], clips: [clip], tracks: [track] });
	return { source, clip, track, project };
}

export async function logarithmicScaleProjectFile() {
	const { source, clip, project } = spectrogramScaleProject();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 4800 }, (_, frame) => .1 * Math.sin(frame * 2 * Math.PI * 440 / 48000))]);
		await writer.commit();
		const archive = await exportScapeProject(project, store);
		assert.ok(archive.blob, 'the native archive producer must return a downloadable file');
		return { project, clip, file: { name: 'Logarithmic.sscape', mimeType: 'application/zip',
			buffer: Buffer.from(await archive.blob.arrayBuffer()) } };
	} finally { await store.close(); }
}
