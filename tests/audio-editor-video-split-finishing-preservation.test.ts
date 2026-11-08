/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { applyFramescaperProjectCommand, prepareFramescaperVideoTransitionAllocations } from '../src/framescaper/editor-project-commands.ts';
import { normalizeVideoVisualPresentationV1 } from '../src/common/editor/video-visual-presentation-v27.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { resolveEditingActionAvailability } from '../src/common/editor/commands/editing-selection-authority.ts';

test('splitting a video clip preserves its clip-owned finishing on the right child', () => {
	let project = createFramescaperProject(PROFILE, framescaperBaselineOptions());
	const presentation = normalizeVideoVisualPresentationV1({ schemaVersion: 1, id: 'finishing',
		owner: { kind: 'clip', id: 'video-clip' }, enabled: true, opacity: 0.5, blendMode: 'normal',
		grade: null, processorStackId: null, maskMatteIds: [] });
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'video-visual-presentation/set',
		presentationId: presentation.id, expectedPresentation: null, presentation });
	const prepared = prepareFramescaperVideoTransitionAllocations(PROFILE, project, { type: 'clip/split',
		clipId: 'video-clip', rightClipId: 'right', atFrame: 24000 }, () => crypto.randomUUID());
	const split = applyFramescaperProjectCommand(PROFILE, project, prepared);
	const right = presentations(split).find(value => value.owner.kind === 'clip' && value.owner.id === 'right');
	assert.ok(right, 'the right child retains its authored finishing');
	assert.equal(right.opacity, 0.5);
	assert.equal(presentations(split).find(value => value.id === 'finishing')?.opacity, 0.5);
	assert.notEqual(right.id, presentation.id);
	const joined = applyFramescaperProjectCommand(PROFILE, split, { type: 'clip/join', clipIds: ['video-clip', 'right'] });
	assert.equal(joined.clips.filter(clip => clip.kind === 'video').length, 1);
	assert.equal(presentations(joined).find(value => value.id === 'finishing')?.opacity, 0.5);
});

test('joining camera clips cannot silently discard a different clip-owned finish', () => {
	let project = createFramescaperProject(PROFILE, framescaperBaselineOptions());
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'clip/split',
		clipId: 'video-clip', rightClipId: 'right', atFrame: 24000 });
	const presentation = normalizeVideoVisualPresentationV1({ schemaVersion: 1, id: 'right-finishing',
		owner: { kind: 'clip', id: 'right' }, enabled: true, opacity: 0.5, blendMode: 'normal',
		grade: null, processorStackId: null, maskMatteIds: [] });
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'video-visual-presentation/set',
		presentationId: presentation.id, expectedPresentation: null, presentation });
	assert.equal(resolveEditingActionAvailability({
		project: createEditorProjectRuntimeSelection(PROFILE).projectForCommandConsumers(project),
		explicitClipIds: ['video-clip', 'right'],
	}).join, true, 'the shipped Edit > Audio clips > Join gate offers this camera selection');
	assert.throws(() => applyFramescaperProjectCommand(PROFILE, project, {
		type: 'clip/join', clipIds: ['video-clip', 'right'],
	}), /finishing|presentation|processing/iu);
	assert.throws(() => applyFramescaperProjectCommand(PROFILE, project, { type: 'batch', commands: [{
		type: 'clip/join', clipIds: ['video-clip', 'right'],
	}] }), /finishing|presentation|processing/iu);
});

function presentations(project: unknown) {
	assert.ok(project && typeof project === 'object' && 'videoVisualPresentations' in project);
	assert.ok(Array.isArray(project.videoVisualPresentations));
	return project.videoVisualPresentations.map(normalizeVideoVisualPresentationV1);
}
