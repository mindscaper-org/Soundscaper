/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, loadSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { applyMixerSurfaceCommandV21, mixerTrackSurfaceRouteV21 } from '../src/common/editor/mixer-graph-surface-v21.ts';

for (const sendId of ['__proto__', 'constructor', 'toString', 'reverb']) {
	test(`native send ${sendId} keeps its authored compact-mixer level and accepts an edit`, async () => {
		const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 512, channelCount: 2 });
		let project = createSoundscaperProject({ id: `send-${sendId}`, sampleRate: 48_000, sources: [source],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 512, sourceDurationFrames: 512 })] });
		project = createSoundscaperProject({ ...project, mixer: applyMixerSurfaceCommandV21(project, {
			type: 'mixer/bus-add', busType: 'send', bus: { id: sendId, name: 'Reverb' },
		}) });
		project = createSoundscaperProject({ ...project, mixer: applyMixerSurfaceCommandV21(project, {
			type: 'mixer/route-update', trackId: 'voice', changes: { sends: { [sendId]: 0.5 } },
		}) });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `native-send-${sendId}` });
		const destination = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `native-send-reopen-${sendId}` });
		try {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(512).fill(0.1), new Float32Array(512).fill(0.1)]); await writer.commit();
			const native = createSoundscaperScapeNativeRuntime();
			const archived = await native.exportScapeProject(project, store);
			assert.ok(archived.blob);
			const loaded = loadSoundscaperProject((await native.importScapeProject(archived.blob, destination)).project);
			assert.equal(loaded.readOnly, false);
			assert.ok(validateSoundscaperProject(loaded.project));
			const opened = loaded.project;
			const route = mixerTrackSurfaceRouteV21(opened.mixer, 'voice', { sourceChannels: 2, masterChannels: 2 });
			assert.equal(Object.hasOwn(route.sends, sendId), true);
			assert.equal(route.sends[sendId], 0.5);
			assert.equal(opened.mixer.edges.find(edge => edge.kind === 'send')?.level, 0.5);
			const edited = applyMixerSurfaceCommandV21(opened, {
				type: 'mixer/route-update', trackId: 'voice', changes: { sends: { ...route.sends, [sendId]: 0.25 } },
			});
			assert.equal(edited.edges.find(edge => edge.kind === 'send')?.level, 0.25);
			assert.equal(mixerTrackSurfaceRouteV21(edited, 'voice', { sourceChannels: 2, masterChannels: 2 }).sends[sendId], 0.25);
		} finally { await store.close(); await destination.close(); }
	});
}
