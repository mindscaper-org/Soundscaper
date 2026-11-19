/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

async function openPictureTrimProject() {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const options = framescaperBaselineOptions();
	const clips = options.clips as Record<string, unknown>[];
	const footage = ['left', 'center', 'right'].map((id, index) => ({
		...clips[0], id, sequenceStartFrame: 20 + index * 4, sequenceFrameCount: 4, sourceInFrame: 2, sourceFrameCount: 4,
	}));
	options.clips = [...footage, clips[1]];
	(options.tracks as Record<string, unknown>[])[0]!.clipIds = footage.map(({ id }) => id);
	const base = createFramescaperProject(PROFILE, options);
	const { clip, source, bytes } = createFramescaperBaselineImageFixture();
	const earlierImage = { ...clip, sequenceFrameCount: 10 };
	assert.ok(await environment.createProjectIfAbsent(base));
	const authored = applyFramescaperProjectCommand(PROFILE, base, { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId: earlierImage.id, expectedClip: null, expectedPlacement: null,
			clip: earlierImage, placement: { scope: 'timeline', trackId: 'video-track' } },
	] });
	assert.ok(await environment.timelineImages.publishIfCurrent({ expected: base, project: authored, bytes }));
	const controller = await createFramescaperFixtureController(environment, base.id);
	await controller.ready;
	return { controller, earlierImage, async close() { await controller.dispose(); await environment.close(); } };
}

for (const mode of ['roll', 'ripple', 'slide'] as const) test(`Clip Boundaries > ${mode} leaves an earlier image untouched`, async () => {
	const fixture = await openPictureTrimProject();
	const { controller, earlierImage } = fixture;
	try {
		const trim = controller.actions.video.trim;
		const plan = mode === 'slide'
			? trim.slipSlide.commit({ mode, activeClipId: 'center', requestedStartSample: 25 * 4800 })
			: trim.rollRipple.commit({ mode, activeClipId: mode === 'roll' ? 'left' : 'center', edge: 'right',
				requestedBoundarySample: (mode === 'roll' ? 25 : 27) * 4800 });
		assert.equal(plan.kind, 'transform');
		assert.equal(plan.sequenceFrameDelta, mode === 'ripple' ? -1 : 1);
		assert.deepEqual(controller.project?.clips.find(clip => clip.id === earlierImage.id), earlierImage);
		assert.equal(controller.getSnapshot().history.undoEntries.length, 1);
	} finally { await fixture.close(); }
});
