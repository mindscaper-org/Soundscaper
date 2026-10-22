/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { parseXmlDocument, walkXml } from '../src/common/editor/dawproject-xml.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

test('Export DAWproject retains the native beat clock of a musical strip lane', async () => {
	const project = createSoundscaperProject({ id: 'beat-export', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', sourceDurationFrames: 96_000, durationFrames: 96_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })],
		tempoMap: { mode: 'musical', events: [{ id: 'root', beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
			{ id: 'faster', beat: { num: 1, den: 1 }, bpm: { num: 120, den: 1 } }] },
		automationLanes: [{ id: 'gain', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'musical-beats', points: [{ id: 'a', position: { num: 0, den: 1 }, value: 0.2 },
				{ id: 'b', position: { num: 2, den: 1 }, value: 1 }], segments: [{ kind: 'linear' }] }],
	});
	let saved: Blob | null = null;
	const fixture = createFixture({ getProject: () => project,
		store: { estimateStorage: async () => ({ usage: 0, quota: 2 ** 30 }),
			beginSourceWrite: async () => { throw new Error('Export must not write sources.'); }, deleteSource: async () => undefined,
			async *readSourceChunks() { yield { channels: [new Float32Array(96_000).fill(0.25)] }; } },
		fileService: { isDesktop: false, chooseSaveTarget: async () => null,
			prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
			saveFile: async request => { assert.ok(request.blob instanceof Blob); saved = request.blob; return { fileName: request.suggestedName }; } },
	});
	fixture.replaceProject(project.id);
	await createNativeProjectService(fixture.runtime).saveDawproject(); assert.ok(saved);
	const archive = await readDawprojectArchive(saved);
	try {
		const points = [...walkXml(parseXmlDocument(archive.projectXml))].find(element => element.name === 'Points'); assert.ok(points);
		assert.equal(points.attributes.timeUnit, 'beats');
		assert.deepEqual(points.children.filter(element => element.name === 'RealPoint').map(point => point.attributes.time), ['0', '2']);
	} finally { await archive.close(); }
});
