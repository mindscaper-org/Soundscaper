/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLabelTrack } from '../src/common/editor/project-media-factory.ts';

import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperProjectTimelineImage,
} from '../src/framescaper/editor-project-timeline-image.ts';
import {
	createFramescaperVideoExportImageExecutionTimelineImage as createExecution,
} from '../src/framescaper/video-export-image-execution-timeline-image.ts';
import { createFramescaperVideoExportStrategyTimelineImage } from '../src/framescaper/video-export-strategy-timeline-image.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../src/framescaper/editor-project-assistance-foundation.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

type Data = Record<string, unknown>;

function project(): Data {
	return createFramescaperProjectTimelineImage(PROFILE, {} as never) as unknown as Data;
}

function options(overrides: Data = {}): never {
	return {
		profile: PROFILE,
		project: project(),
		foundationPlan: unifiedExactPlanFixture(13),
		signal: new AbortController().signal,
		assertCurrent: () => undefined,
		...overrides,
	} as unknown as never;
}

test('a project with no visible image clips composes no supplemental execution', async () => {
	assert.equal(
		await createExecution(options()),
		null,
		'an export with nothing supplemental to draw must not demand an asset store',
	);
});

test('an already-cancelled export surfaces the caller abort reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the export');
	controller.abort(reason);

	await assert.rejects(
		() => createExecution(options({ signal: controller.signal })),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);
});

test('a project that moved under the export is refused before any asset work', async () => {
	const stale = new RangeError('the project advanced under the export');

	await assert.rejects(
		() => createExecution(options({ assertCurrent: () => { throw stale; } })),
		(error: unknown) => {
			assert.equal(error, stale);
			return true;
		},
	);
});

test('an image project with a label track can be prepared for delivery', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const projectWithLabels = applyFramescaperProjectCommand(PROFILE, fixture.project, {
		type: 'track/add', track: createLabelTrack({ id: 'labels', name: 'Labels' }),
	});
	const canonicalProject = framescaperProjectTimelineImageFoundationShapeAssistance(projectWithLabels);
	const strategy = createFramescaperVideoExportStrategyTimelineImage(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: {
		project: canonicalProject, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	} });
	assert.equal(strategy.hasPicture?.(exportProject), true);
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'webm', range: 'project',
		includeAudio: false, canvas: { width: 640, height: 360 },
	});
	assert.ok(plan);
});

test('a soloed picture track in a different sequence does not suppress primary image delivery', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = applyFramescaperProjectCommand(PROFILE, fixture.project, { type: 'batch', commands: [
		{ type: 'sequence/create', sequence: { ...fixture.project.sequences[0],
			id: 'other-sequence', name: 'Other', trackIds: [], trackNodes: [] } },
		{ type: 'track/add', sequenceId: 'other-sequence', track: { id: 'foreign-picture', name: 'Foreign picture',
			type: 'video', clipIds: [], solo: true } },
	] });
	const canonicalProject = framescaperProjectTimelineImageFoundationShapeAssistance(project);
	const strategy = createFramescaperVideoExportStrategyTimelineImage(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: {
		project: canonicalProject, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	} });
	assert.equal(strategy.hasPicture?.(exportProject), true);
	assert.ok(strategy.createPlan({ canonicalProject, exportProject, format: 'webm', range: 'project',
		includeAudio: false, canvas: { width: 640, height: 360 },
	}));
});

test('an image in a hidden folder neither enables export nor gets opened by its executor', async () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const project = applyFramescaperProjectCommand(PROFILE, fixture.project, { type: 'batch', commands: [
		{ type: 'track-folder/add', sequenceId: 'main-sequence', folder: { id: 'pictures', name: 'Pictures', hidden: true } },
		{ type: 'track-node/move', sequenceId: 'main-sequence', nodeId: 'video-track', parentFolderId: 'pictures', index: 0 },
	] });
	const canonicalProject = framescaperProjectTimelineImageFoundationShapeAssistance(project);
	const strategy = createFramescaperVideoExportStrategyTimelineImage(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: {
		project: canonicalProject, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	} });
	assert.equal(strategy.hasPicture?.(exportProject), false);
	assert.equal(await createExecution(options({ project: canonicalProject, foundationPlan: {
		...unifiedExactPlanFixture(13), nodes: [{ kind: 'visual', modelId: fixture.clip.id,
			placement: { trackId: 'video-track' }, authoredState: { source: { kind: 'generator' } } }],
	} })), null);
});

test('a range containing only still images can be exported from a project that also contains video', () => {
	const fixture = createFramescaperBaselineImageFixture();
	const canonicalProject = framescaperProjectTimelineImageFoundationShapeAssistance(fixture.project);
	const strategy = createFramescaperVideoExportStrategyTimelineImage(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: {
		project: canonicalProject, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	} });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'webm',
		range: { startFrame: 96_000, endFrame: 144_000 }, includeAudio: false, canvas: { width: 640, height: 360 },
	});
	assert.equal(plan?.strategy, 'framescaper-visual-rgba');
});

test('File > Export Video project range ends with the primary sequence, even with a later image in an unused sequence', () => {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const foreign = { ...fixture.clip, id: 'unused-image', sequenceId: 'unused-sequence', sequenceStartFrame: 900 };
	const project = applyFramescaperProjectCommand(PROFILE, fixture.project, { type: 'batch', commands: [
		{ type: 'sequence/create', sequence: { ...fixture.project.sequences[0],
			id: 'unused-sequence', name: 'Unused', trackIds: [], trackNodes: [] } },
		{ type: 'track/add', sequenceId: 'unused-sequence', track: { id: 'unused-picture', name: 'Unused picture',
			type: 'video', clipIds: [] } },
		{ type: 'image-clip/set', clipId: foreign.id, expectedClip: null, expectedPlacement: null,
			clip: foreign, placement: { scope: 'timeline', trackId: 'unused-picture' } },
	] });
	const canonicalProject = framescaperProjectTimelineImageFoundationShapeAssistance(project);
	const strategy = createFramescaperVideoExportStrategyTimelineImage(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: {
		project: canonicalProject, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	} });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'webm', range: 'project',
		includeAudio: false, canvas: { width: 640, height: 360 },
	});
	assert.deepEqual(plan?.range, { startFrame: 0, endFrame: 720_000, durationFrames: 720_000 });
});
