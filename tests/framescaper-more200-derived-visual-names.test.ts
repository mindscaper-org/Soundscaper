/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { framescaperSelectedVisualAuthoringRuntimeFor } from '../src/framescaper/editor-selected-finishing-authoring-controller.ts';
import { createFramescaperSelectedVisualAuthoringModelFinishing } from '../src/framescaper/editor-selected-finishing-visual-authoring-model.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { normalizeVideoVisualPresetV1 } from '../src/common/editor/video-visual-preset-v24.ts';
import { createFramescaperFixtureController } from './helpers/framescaper-controller-project-fixture.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { bindFramescaperSelectedFreezeCaptureFinishing } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { normalizeVideoStillSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';

for (const name of ['A'.repeat(512), `${'A'.repeat(505)}😀Title`, 'Short name']) {
	test(`a ${name.length}-unit visual preset keeps its complete name and a bounded donor`, async context => {
		const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
			indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		} });
		const controller = createFramescaperAudioEditorController(environment);
		context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
		const author = framescaperCandidateAuthoringActionRuntimeFor(controller);
		const presets = framescaperSelectedVisualAuthoringRuntimeFor(controller); assert.ok(author && presets);
		await author.run('video-title');
		const clip = normalizeVideoGeneratorClipV1(controller.project?.clips.at(-1));
		controller.actions.timeline.selectClip(clip.id);
		const before = controller.project; assert.ok(before);
		const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-visual-preset',
			project: before, selectedClipId: clip.id, playheadSample: 0 });
		await presets.run('video-visual-preset', { fence: model.fence, clipId: clip.id, operation: 'save-visual', name });
		const after = controller.project; assert.ok(after && Array.isArray(after.videoVisualPresets));
		const preset = normalizeVideoVisualPresetV1(after.videoVisualPresets.at(-1)); assert.equal(preset.name, name);
		const donor = normalizeVideoGeneratorClipV1(after.projectBin.clips.at(-1));
		const source = normalizeVideoGeneratorSourceV1(after.sources.find(value => value.id === donor.sourceId));
		assert.ok(source.name.length <= 512); assert.ok(source.name.endsWith(' Model'));
		assert.doesNotMatch(source.name, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u);
		assert.deepEqual(after.sources.find(value => value.id === clip.sourceId), before.sources.find(value => value.id === clip.sourceId));
		controller.actions.edit.undo(); assert.deepEqual(controller.project?.videoVisualPresets, before.videoVisualPresets);
		assert.deepEqual(controller.project?.projectBin, before.projectBin);
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.videoVisualPresets, after.videoVisualPresets);
	});
}

test('Freeze preserves a full-length camera name while bounding its derived PNG source name', async context => {
	const options = framescaperBaselineOptions(); assert.ok(Array.isArray(options.sources));
	const sources: readonly unknown[] = options.sources;
	options.sources = sources.map(value => {
		assert.ok(value !== null && typeof value === 'object' && 'kind' in value);
		return value.kind === 'video' ? { ...value, name: 'Camera'.repeat(85) + 'AB' } : value;
	});
	const project = createFramescaperProject(PROFILE, options);
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false } });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const runtime = framescaperSelectedVisualAuthoringRuntimeFor(controller); assert.ok(runtime);
	context.after(bindFramescaperSelectedFreezeCaptureFinishing(controller, { capture: async () => ({
		blob: new Blob([Uint8Array.of(137, 80, 78, 71)], { type: 'image/png' }), width: 1, height: 1 }) }));
	controller.actions.timeline.selectClip('video-clip');
	const model = createFramescaperSelectedVisualAuthoringModelFinishing({ surface: 'video-freeze',
		project: controller.project, selectedClipId: 'video-clip', playheadSample: 0 });
	await runtime.run('video-freeze', { fence: model.fence, clipId: 'video-clip', operation: 'create',
		playheadSample: 0, durationFrames: 10 });
	const leaves: readonly unknown[] = controller.project?.sources ?? [];
	const source = normalizeVideoStillSourceV1(leaves.find(value => value !== null && typeof value === 'object'
		&& 'kind' in value && value.kind === 'still'));
	assert.ok(source.name.length <= 512); assert.ok(source.name.endsWith(' Freeze'));
	assert.deepEqual(controller.project?.sources.find(value => value.id === 'video-source'),
		project.sources.find(value => value.id === 'video-source'));
});
