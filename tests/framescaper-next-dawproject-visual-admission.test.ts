/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { readDawprojectArchive } from '../src/common/editor/dawproject-archive.ts';
import { isDeliveryReport } from '../src/common/editor/delivery-report.ts';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const scope of ['timeline', 'bin', 'none'] as const) {
	test(`DAWproject export retains editable audio with a ${scope} visual owner`, async () => {
		const source = createAudioSource({ id: 'audio', name: 'Programme.wav', frameCount: 24_000, channelCount: 1, sampleRate: 48_000 });
		const visual = { schemaVersion: 1, kind: 'generator', id: 'title', sourceId: 'title-source', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 };
		const project = createFramescaperProject(PROFILE, {
			id: 'project-a', sources: [source],
			visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'title-source', name: 'Title',
				width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150,
				generator: { kind: 'solid', color: '#ffffffff' } }] },
			clips: [createAudioClip({ id: 'voice', sourceId: source.id, timelineStartFrame: 0,
				durationFrames: 24_000, sourceDurationFrames: 24_000 }), ...(scope === 'timeline' ? [visual] : [])],
			projectBin: { clips: scope === 'bin' ? [visual] : [] },
			tracks: [{ id: 'sound', type: 'audio', clipIds: ['voice'] },
				{ id: 'pictures', type: 'video', clipIds: scope === 'timeline' ? ['title'] : [] }],
			sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['sound', 'pictures'] }], primarySequenceId: 'main',
		});
		const original = structuredClone(project);
		const blobs: Blob[] = [];
		const fixture = createFixture({
			getProject: () => project, loadStoredSourceChannels: async () => [new Float32Array(24_000).fill(0.25)],
			fileService: {
				isDesktop: false, chooseSaveTarget: async () => null,
				prepareSave: async request => ({ mode: 'blob', fileName: request.suggestedName, target: null }),
				saveFile: async request => {
					assert.ok(request.blob instanceof Blob); blobs.push(request.blob);
					return { fileName: request.suggestedName };
				},
			},
		});
		const result = await createNativeProjectService(fixture.runtime).saveDawproject();
		assert.ok(isDeliveryReport(result.report));
		assert.equal(fixture.runtime.state.deliveryReport, result.report);
		const omissions = result.report.items.filter(item => item.code === 'dawproject.unsupported-visual-clip-omitted');
		assert.equal(omissions.length, scope === 'timeline' ? 1 : 0, 'only delivered timeline owners need omission warnings');
		if (scope === 'timeline') assert.deepEqual(omissions[0]?.scope, { kind: 'clip', id: 'title' });
		assert.deepEqual(project, original, 'export admission must not remove the authored or parked visual');
		assert.equal(blobs.length, 1); assert.ok(blobs[0]);
		const archive = await readDawprojectArchive(blobs[0]);
		try {
			assert.match(archive.projectXml, /Programme/u);
			const path = archive.entryNames.find(name => name.endsWith('.wav')); assert.ok(path);
			const wav = await archive.readEntry(path); assert.ok(wav);
			assert.equal(wav.size, 44 + 24_000 * 4);
			const samples = new DataView(await wav.arrayBuffer());
			for (let frame = 0; frame < 24_000; frame += 1) assert.equal(samples.getFloat32(44 + frame * 4, true), 0.25);
		} finally { await archive.close(); }
	});
}
