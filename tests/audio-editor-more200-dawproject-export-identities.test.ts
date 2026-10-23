/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const trackIds of [['voice', 'voice:volume'], ['voice', 'voice:pan', 'voice:mute'], ['master'], ['ordinary']] as const) {
	test(`native DAWproject delivery and reopen preserve distinct identities for ${trackIds.join(',')}`, async () => {
		const project = createSoundscaperProject({ id: 'export-identities', sampleRate: 48_000,
			sources: [createAudioSource({ id: 'source', name: 'Constant.wav', sampleRate: 48_000, frameCount: 4_800, channelCount: 1 })],
			clips: trackIds.map((_, index) => createAudioClip({ id: `clip-${index}`, sourceId: 'source', sourceDurationFrames: 4_800, durationFrames: 4_800 })),
			tracks: trackIds.map((id, index) => createAudioTrack({ id, name: `Voice ${index + 1}`, clipIds: [`clip-${index}`] })),
		});
		const saved: Blob[] = [];
		const fixture = createFixture({ getProject: () => project,
			store: { estimateStorage: async () => ({ usage: 0, quota: 2 ** 30 }),
				beginSourceWrite: async () => { throw new Error('Export must not write sources'); }, deleteSource: async () => undefined,
				async *readSourceChunks() { yield { channels: [new Float32Array(4_800).fill(0.25)] }; } },
			fileService: { isDesktop: false, chooseSaveTarget: async () => null,
				prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
				saveFile: async request => { assert.ok(request.blob instanceof Blob); saved.push(request.blob); return { fileName: request.suggestedName }; } },
		});
		fixture.replaceProject(project.id);
		await createNativeProjectService(fixture.runtime).saveDawproject();
		assert.equal(saved.length, 1);
		const blob = saved[0]; assert.ok(blob);
		const archive = await readDawprojectArchive(blob);
		try {
			const document = parseDawprojectDocument(archive.projectXml);
			const tracks = document.tracks.filter(track => track.channel?.role === 'regular');
			assert.equal(tracks.length, trackIds.length);
			assert.deepEqual(tracks.map(track => track.name), trackIds.map((_, index) => `Voice ${index + 1}`));
		} finally { await archive.close(); }
		let minted = 0;
		const importer = createFixture({ createStableId: prefix => `${prefix}-${++minted}` });
		const opened = await createNativeProjectService(importer.runtime).openDawproject(new File([blob], 'Roundtrip.dawproject'));
		assert.ok(opened);
		assert.equal(opened.project.clips.length, trackIds.length, 'own export must reopen every source occurrence');
	});
}
